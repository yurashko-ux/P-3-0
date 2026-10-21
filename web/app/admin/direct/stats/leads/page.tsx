"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { invalidateLeadSourcesMapCache } from "@/app/admin/direct/_components/useLeadSourcesMap";

type Kind = "ads" | "organic" | "website";

type Source = {
  id: string;
  code: string;
  name: string;
  mark: string | null;
  kind: Kind;
  enabled: boolean;
  hidden: boolean;
  leads: number;
  consultations: number;
  paid: number;
  totalLeads: number;
};

type AdIdRow = {
  id: string;
  adId: string;
  adTitle: string | null;
  sourceCode: string | null;
  sourceName: string | null;
  firstSeenAt: string;
  leadsCount: number;
  lastUsername: string | null;
};

const KIND_LABEL: Record<Kind, string> = {
  ads: "Реклама",
  organic: "Органіка",
  website: "Сайт",
};

// Готовий набір значків для "Знак" — візуально біля хмарки в Direct.
// Старий механізм пошуку знака в тексті першого повідомлення нічого не чіпає.
// Перші 20 — як були; далі +20 нових (не чіпати існуючі).
const MARK_EMOJI_OPTIONS = [
  "💙", "💚", "💛", "🧡", "💜", "🖤", "🤍", "❤️", "🩷", "🩵",
  "⭐", "🔥", "✨", "🎯", "🔵", "🟢", "🟣", "🟠", "🟡", "🔴",
  "🍀", "🌿", "🌸", "🌺", "🍄", "🌟", "🔑", "💎", "🌙", "☀️",
  "🦋", "🐠", "🦊", "🦄", "🎈", "🎀", "🧩", "🎵", "⚡", "🌊",
];

// Поле "Знак" з попапом вибору емодзі — випадає при фокусі, сітка як у emoji-picker.
function MarkField({
  value,
  onChange,
  inputClassName,
}: {
  value: string;
  onChange: (mark: string) => void;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <input
        className={inputClassName || "input input-bordered input-sm w-24"}
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(event) => onChange(event.target.value)}
        placeholder="значок"
      />
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-[280px] rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
          <div className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
            Оберіть значок
          </div>
          <div className="grid max-h-[220px] grid-cols-8 gap-0.5 overflow-y-auto">
            {MARK_EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-base transition-colors hover:bg-gray-100 ${
                  value === emoji ? "bg-blue-100 ring-1 ring-blue-400" : ""
                }`}
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                }}
                title={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
          {value ? (
            <button
              type="button"
              className="mt-1.5 w-full rounded-lg px-2 py-1 text-left text-[11px] text-gray-500 hover:bg-gray-50"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Прибрати значок
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Список ad_id оголошень Meta (referral): прив'язка один раз на оголошення, надалі ліди визначаються автоматично. */
function AdIdsPanel({ sources }: { sources: Source[] }) {
  const [rows, setRows] = useState<AdIdRow[]>([]);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Згорнуто за замовчуванням: список може розростись, тому ховаємо його під кнопку,
  // щоб не розтягувати сторінку. Лічильник непризначених показуємо завжди, навіть згорнутим.
  const [expanded, setExpanded] = useState(false);

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
      <button
        type="button"
        className="flex w-full items-center justify-between rounded border px-3 py-2 text-left hover:bg-gray-50"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <span className="text-lg font-semibold">Оголошення Meta (ad_id)</span>
          {unresolved.length > 0 ? (
            <span className="badge badge-warning badge-sm">{unresolved.length} нові</span>
          ) : null}
          {rows.length > 0 ? <span className="text-xs text-gray-400">всього {rows.length}</span> : null}
        </span>
        <span className="text-sm text-gray-500">{expanded ? "Згорнути ▲" : "Показати ▼"}</span>
      </button>
      {expanded ? (
        <div className="mt-2">
          <p className="mb-3 text-sm text-gray-600">
            Надійніша прив'язка за фактом конкретного оголошення (referral.ad_id), а не за знаком у тексті.
            Призначте кабінет один раз для нового оголошення — надалі всі ліди з нього визначаються автоматично,
            уже отримані теж донараховуються.
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
                <th>Instagram юзернейм</th>
                <th>Кабінет</th>
              </tr>
            </thead>
            <tbody>
              {[...unresolved, ...resolved].map((row) => (
                <tr key={row.id} className={!row.sourceCode ? "bg-amber-50" : undefined}>
                  <td className="font-mono text-xs">{row.adId}</td>
                  <td className="text-sm">{row.adTitle || <span className="text-gray-400">—</span>}</td>
                  <td>{row.leadsCount}</td>
                  <td className="text-sm">
                    {row.lastUsername ? (
                      <a
                        href={`https://instagram.com/${row.lastUsername}`}
                        target="_blank"
                        rel="noreferrer"
                        className="link"
                      >
                        @{row.lastUsername}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
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
      ) : null}
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMark, setEditMark] = useState("");
  const [editKind, setEditKind] = useState<Kind>("ads");

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
    invalidateLeadSourcesMapCache();
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
    if (!confirm("Прибрати це джерело?")) return;
    const response = await fetch(`/api/admin/direct/lead-sources?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      setError(data?.error || "Не видалилось");
      return;
    }
    await load(month);
  }

  // Приховати/показати в списку вибору ручного призначення джерела — доступно незалежно від того,
  // є вже ліди чи ні (на відміну від редагування/видалення), бо не чіпає статистику.
  async function toggleHidden(source: Source) {
    setError("");
    const response = await fetch("/api/admin/direct/lead-sources/visibility", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, hidden: !source.hidden }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      setError(data?.error || "Не збереглось");
      return;
    }
    await load(month);
  }

  function startEdit(source: Source) {
    setEditingId(source.id);
    setEditName(source.name);
    setEditMark(source.mark || "");
    setEditKind(source.kind);
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    setSaving(true);
    setError("");
    const response = await fetch("/api/admin/direct/lead-sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingId, name: editName, mark: editMark, kind: editKind }),
    });
    const data = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok || !data?.ok) {
      setError(data?.error || "Не збереглось");
      return;
    }
    setEditingId(null);
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
        Рекламу визначаємо за <code className="text-xs">ad_id</code> з Meta (або знаком у тексті — легасі).
        Органіку ставимо лише вручну з дропдауна на картці ліда; інакше джерело — «не визначено» (хмаринка без значка).
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
            {sources.map((source) => {
              const canModify = source.kind !== "organic" && source.totalLeads === 0;
              // Органіку можна редагувати завжди (щоб обрати емодзі біля хмарки), видаляти/ховати — ні.
              const canEdit = source.kind === "organic" || canModify;
              if (editingId === source.id) {
                return (
                  <tr key={source.id}>
                    <td>
                      <input
                        className="input input-bordered input-xs w-28"
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                      />
                    </td>
                    <td>
                      <MarkField value={editMark} onChange={setEditMark} inputClassName="input input-bordered input-xs w-16" />
                    </td>
                    <td>
                      {editKind === "organic" ? (
                        KIND_LABEL.organic
                      ) : (
                        <select
                          className="select select-bordered select-xs"
                          value={editKind}
                          onChange={(event) => setEditKind(event.target.value as Kind)}
                        >
                          <option value="ads">Реклама</option>
                          <option value="website">Сайт</option>
                        </select>
                      )}
                    </td>
                    <td>{source.leads}</td>
                    <td>{source.consultations}</td>
                    <td>{source.paid}</td>
                    <td>
                      <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
                        <button
                          className="btn btn-primary btn-xs"
                          type="button"
                          disabled={saving || !editName.trim()}
                          onClick={() => void saveEdit()}
                        >
                          зберегти
                        </button>
                        <button className="btn btn-ghost btn-xs" type="button" onClick={cancelEdit}>
                          відміна
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={source.id} className={source.hidden ? "opacity-40" : undefined}>
                  <td>
                    {source.name}
                    {source.hidden ? (
                      <span className="ml-1 text-xs text-gray-400" title="Приховано зі списку вибору в ручному призначенні джерела">
                        (приховано)
                      </span>
                    ) : null}
                  </td>
                  <td>{source.mark || "—"}</td>
                  <td>{KIND_LABEL[source.kind]}</td>
                  <td>{source.leads}</td>
                  <td>{source.consultations}</td>
                  <td>{source.paid}</td>
                  <td>
                    <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
                      {canEdit ? (
                        <button className="btn btn-ghost btn-xs" type="button" onClick={() => startEdit(source)}>
                          редагувати
                        </button>
                      ) : null}
                      {canModify ? (
                        <button className="btn btn-ghost btn-xs" type="button" onClick={() => void removeSource(source.id)}>
                          прибрати
                        </button>
                      ) : source.kind !== "organic" ? (
                        <span className="text-xs text-gray-400" title="Є ліди з цим джерелом — видалення заборонено">
                          є ліди
                        </span>
                      ) : null}
                      {source.kind !== "organic" ? (
                        <button
                          className="btn btn-ghost btn-xs"
                          type="button"
                          title="Прибрати/повернути зі списку вибору в ручному призначенні джерела (статистику не чіпає)"
                          onClick={() => void toggleHidden(source)}
                        >
                          {source.hidden ? "показати" : "приховати"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
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
              <span className="label-text text-xs">Знак (клацніть у поле — випаде список значків)</span>
              <MarkField value={mark} onChange={setMark} />
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
