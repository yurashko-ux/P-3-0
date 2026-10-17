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

const KIND_LABEL: Record<Kind, string> = {
  ads: "Реклама",
  organic: "Органіка",
  website: "Сайт",
};

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
