"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Kind = "ads" | "organic" | "website";

type Source = {
  id: string;
  code: string;
  name: string;
  mark: string | null;
  kind: Kind;
  enabled: boolean;
  leads: number;
  consultations: number;
  paid: number;
};

type AdIdRow = {
  id: string;
  adId: string;
  adTitle: string | null;
  sourceCode: string | null;
  sourceName: string | null;
  firstSeenAt: string;
  leadsCount: number;
};

const KIND_LABEL: Record<Kind, string> = {
  ads: "Реклама",
  organic: "Органіка",
  website: "Сайт",
};

/** Список ad_id оголошень Meta (referral): прив'язка один раз на оголошення, надалі ліди визначаються автоматично. */
function AdIdsPanel({ sources }: { sources: Source[] }) {
  const [rows, setRows] = useState<AdIdRow[]>([]);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/admin/direct/lead-sources/ad-ids", { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      setError(data?.error || "Не вдалося відкрити оголошення");
      setLoading(false);
      return;
    }
    setError("");
    setRows(data.adIds || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign(adId: string, sourceCode: string) {
    setSavingId(adId);
    setError("");
    try {
      const response = await fetch("/api/admin/direct/lead-sources/ad-ids", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adId, sourceCode: sourceCode || null }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Не збереглось");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSavingId(null);
    }
  }

  const adsSources = sources.filter((s) => s.kind === "ads");
  const unresolved = rows.filter((r) => !r.sourceCode);
  const resolved = rows.filter((r) => r.sourceCode);

  return (
    <div className="mb-6">
      <h2 className="mb-1 text-lg font-semibold">Оголошення Meta (ad_id)</h2>
      <p className="mb-3 text-sm text-gray-600">
        Надійніша прив'язка за фактом конкретного оголошення (referral.ad_id), а не за знаком у тексті. Призначте
        кабінет один раз для нового оголошення — надалі всі ліди з нього визначаються автоматично, уже отримані теж
        донараховуються.
      </p>
      {error ? <div className="mb-2 text-sm text-red-600">{error}</div> : null}
      {loading ? (
        <p className="text-sm text-gray-500">Завантаження…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">Оголошень ще не бачили. З'являться тут після першого ліда з реклами.</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>ad_id</th>
                <th>Назва оголошення</th>
                <th>Лідів</th>
                <th>Кабінет</th>
              </tr>
            </thead>
            <tbody>
              {[...unresolved, ...resolved].map((row) => (
                <tr key={row.id} className={!row.sourceCode ? "bg-amber-50" : undefined}>
                  <td className="font-mono text-xs">{row.adId}</td>
                  <td className="text-sm">{row.adTitle || <span className="text-gray-400">—</span>}</td>
                  <td>{row.leadsCount}</td>
                  <td>
                    <select
                      className="select select-bordered select-xs"
                      value={row.sourceCode || ""}
                      disabled={savingId === row.adId}
                      onChange={(event) => void assign(row.adId, event.target.value)}
                    >
                      <option value="">— не призначено —</option>
                      {adsSources.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function LeadSourcesPage() {
  const [month, setMonth] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [mark, setMark] = useState("");
  const [kind, setKind] = useState<Kind>("ads");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (nextMonth?: string) => {
    const query = nextMonth ? `?month=${encodeURIComponent(nextMonth)}` : "";
    const response = await fetch(`/api/admin/direct/lead-sources${query}`, { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      setError(data?.error || "Не вдалося відкрити джерела");
      return;
    }
    setError("");
    setMonth(data.month || "");
    setSources(data.sources || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createSource() {
    setSaving(true);
    setError("");
    const response = await fetch("/api/admin/direct/lead-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mark, kind }),
    });
    const data = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok || !data?.ok) {
      setError(data?.error || "Не збереглось");
      return;
    }
    setName("");
    setMark("");
    setKind("ads");
    await load(month);
  }

  async function removeSource(id: string) {
    if (!confirm("Прибрати це джерело? Вже проставлені ліди лишаться зі своїм кодом.")) return;
    const response = await fetch(`/api/admin/direct/lead-sources?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      setError(data?.error || "Не видалилось");
      return;
    }
    await load(month);
  }

  return (
    <div className="w-full max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Джерела</h1>
        <Link href="/admin/direct/stats" className="text-sm link">
          Статистика
        </Link>
      </div>
      <p className="mb-4 text-sm text-gray-600">
        Знак шукаємо в першому вхідному повідомленні нового ліда. Якщо знака немає — це органіка.
        Сайт сюди потрапить окремим входом, не з Instagram.
      </p>

      <div className="mb-4 flex items-end gap-2">
        <label className="form-control">
          <span className="label-text text-xs">Місяць</span>
          <input
            className="input input-bordered input-sm"
            type="month"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              void load(event.target.value);
            }}
          />
        </label>
      </div>

      {error ? <div className="mb-3 text-sm text-red-600">{error}</div> : null}

      <AdIdsPanel sources={sources} />

      <div className="mb-6 overflow-x-auto rounded border">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Джерело</th>
              <th>Знак</th>
              <th>Тип</th>
              <th>Ліди</th>
              <th>Консультації</th>
              <th>Оплати</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id}>
                <td>{source.name}</td>
                <td>{source.mark || "—"}</td>
                <td>{KIND_LABEL[source.kind]}</td>
                <td>{source.leads}</td>
                <td>{source.consultations}</td>
                <td>{source.paid}</td>
                <td>
                  {source.kind === "organic" ? null : (
                    <button className="btn btn-ghost btn-xs" type="button" onClick={() => void removeSource(source.id)}>
                      прибрати
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded border p-3">
        <div className="mb-2 text-sm font-semibold">Нове джерело</div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="form-control">
            <span className="label-text text-xs">Назва</span>
            <input className="input input-bordered input-sm" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Тип</span>
            <select className="select select-bordered select-sm" value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
              <option value="ads">Реклама</option>
              <option value="website">Сайт</option>
            </select>
          </label>
          {kind === "ads" ? (
            <label className="form-control">
              <span className="label-text text-xs">Знак</span>
              <input className="input input-bordered input-sm w-24" value={mark} onChange={(event) => setMark(event.target.value)} />
            </label>
          ) : null}
          <button className="btn btn-sm btn-primary" type="button" disabled={saving || !name.trim()} onClick={() => void createSource()}>
            Додати
          </button>
        </div>
      </div>
    </div>
  );
}
