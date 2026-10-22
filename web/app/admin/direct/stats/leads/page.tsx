"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  triggerEmojis?: string[];
};

type EmojiRow = {
  id: string;
  emoji: string;
  sourceCode: string | null;
  sourceName: string | null;
  firstSeenAt: string;
  lastUsername: string | null;
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
  onBlur,
  inputClassName,
}: {
  value: string;
  onChange: (mark: string) => void;
  onBlur?: (value: string) => void;
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
        onBlur={(event) => onBlur?.(event.currentTarget.value)}
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

function EditorWindow({
  title,
  saving,
  error,
  onClose,
  onSave,
  saveDisabled,
  children,
}: {
  title: string;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 text-base font-semibold">{title}</div>
        {children}
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose} disabled={saving}>
            Скасувати
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={onSave} disabled={saving || saveDisabled}>
            Зберегти
          </button>
        </div>
      </div>
    </div>
  );
}

/** Знак біля хмарки: зберігаємо після вибору емодзі або коли поле втрачає фокус. */
function CloudMarkCell({
  sourceId,
  mark,
  onCommit,
}: {
  sourceId: string;
  mark: string;
  onCommit: (mark: string) => void;
}) {
  const [value, setValue] = useState(mark);
  useEffect(() => {
    setValue(mark);
  }, [mark, sourceId]);

  return (
    <MarkField
      value={value}
      inputClassName="input input-bordered input-xs !w-16 shrink-0"
      onChange={(next) => {
        setValue(next);
        if (next === "" || MARK_EMOJI_OPTIONS.includes(next)) onCommit(next);
      }}
      onBlur={(next) => {
        if (next.trim() !== mark) onCommit(next);
      }}
    />
  );
}

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
    <section className="min-w-0 rounded border p-3">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-base font-semibold">Оголошення</h2>
        {unresolved.length > 0 ? <span className="badge badge-warning badge-sm">{unresolved.length} нові</span> : null}
      </div>
      {error ? <div className="mb-2 text-sm text-red-600">{error}</div> : null}
      {loading ? (
        <p className="text-sm text-gray-500">Завантаження…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">Оголошень ще не бачили.</p>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="table table-xs">
            <thead>
              <tr>
                <th>ad_id</th>
                <th>Кабінет</th>
              </tr>
            </thead>
            <tbody>
              {[...unresolved, ...resolved].map((row) => (
                <tr key={row.id} className={!row.sourceCode ? "bg-amber-50" : undefined}>
                  <td className="max-w-[14rem] truncate whitespace-nowrap font-mono text-xs" title={row.adTitle || row.adId}>
                    {row.adTitle || row.adId}
                    <span className="ml-2 text-[10px] text-gray-400">{row.leadsCount}</span>
                  </td>
                  <td>
                    <select
                      className="select select-bordered select-xs w-full max-w-[9rem]"
                      value={row.sourceCode || ""}
                      disabled={savingId === row.adId}
                      onChange={(event) => void assign(row.adId, event.target.value)}
                    >
                      <option value="">— не призначено —</option>
                      {adsSources.map((source) => (
                        <option key={source.code} value={source.code}>
                          {source.name}
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
    </section>
  );
}

/** Емодзі з першого повідомлення: кілька на одне джерело. Біля хмарки лишається окремий знак. */
function EmojisPanel({ sources, onChanged }: { sources: Source[]; onChanged: () => void }) {
  const [rows, setRows] = useState<EmojiRow[]>([]);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftSource, setDraftSource] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/admin/direct/lead-sources/emojis", { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      setError(data?.error || "Не вдалося відкрити емодзі");
      setLoading(false);
      return;
    }
    setError("");
    setRows(data.emojis || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign(emoji: string, sourceCode: string): Promise<boolean> {
    setSavingId(emoji);
    setError("");
    try {
      const response = await fetch("/api/admin/direct/lead-sources/emojis", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji, sourceCode: sourceCode || null }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Не збереглось");
      await load();
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
      return false;
    } finally {
      setSavingId(null);
    }
  }

  const adsSources = sources.filter((source) => source.kind === "ads");
  const unresolved = rows.filter((row) => !row.sourceCode);
  const resolved = rows.filter((row) => row.sourceCode);

  return (
    <section className="min-w-0 rounded border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Емодзі</h2>
          {unresolved.length > 0 ? <span className="badge badge-warning badge-sm">{unresolved.length} нові</span> : null}
        </div>
        <button
          className="btn btn-primary btn-xs"
          type="button"
          onClick={() => {
            setError("");
            setAddOpen(true);
          }}
        >
          Додати
        </button>
      </div>
      {error && !addOpen ? <div className="mb-2 text-sm text-red-600">{error}</div> : null}
      {loading ? (
        <p className="text-sm text-gray-500">Завантаження…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">Емодзі ще немає.</p>
      ) : (
        <div className="flex flex-nowrap gap-2 overflow-x-auto">
          {[...unresolved, ...resolved].map((row) => (
            <div
              key={row.id}
              className={`flex h-8 items-center gap-1 whitespace-nowrap rounded border px-2 ${
                row.sourceCode ? "border-gray-200" : "border-amber-300 bg-amber-50"
              }`}
            >
              <span className="text-base leading-none">{row.emoji}</span>
              <select
                className="select select-ghost select-xs h-7 min-h-0 w-[7.5rem] px-1"
                value={row.sourceCode || ""}
                disabled={savingId === row.emoji}
                onChange={(event) => void assign(row.emoji, event.target.value)}
                title={row.lastUsername ? `@${row.lastUsername}` : "Ще без прикладу"}
              >
                <option value="">— немає —</option>
                {adsSources.map((source) => (
                  <option key={source.code} value={source.code}>
                    {source.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      {addOpen ? (
        <EditorWindow
          title="Емодзі до джерела"
          saving={savingId === draft}
          error={error}
          saveDisabled={!draft.trim() || !draftSource}
          onClose={() => {
            setAddOpen(false);
            setDraft("");
            setError("");
          }}
          onSave={() => {
            void assign(draft.trim(), draftSource).then((ok) => {
              if (!ok) return;
              setDraft("");
              setDraftSource("");
              setAddOpen(false);
            });
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="form-control">
              <span className="label-text text-xs">Емодзі</span>
              <MarkField value={draft} onChange={setDraft} />
            </label>
            <label className="form-control">
              <span className="label-text text-xs">Джерело</span>
              <select
                className="select select-bordered select-sm"
                value={draftSource}
                onChange={(event) => setDraftSource(event.target.value)}
              >
                <option value="">— оберіть —</option>
                {adsSources.map((source) => (
                  <option key={source.code} value={source.code}>
                    {source.mark ? `${source.mark} ` : ""}
                    {source.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </EditorWindow>
      ) : null}
    </section>
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
  const [addOpen, setAddOpen] = useState(false);
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
      return false;
    }
    setName("");
    setMark("");
    setKind("ads");
    setAddOpen(false);
    await load(month);
    return true;
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

  async function saveCloudMark(id: string, mark: string) {
    setError("");
    const response = await fetch("/api/admin/direct/lead-sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, mark, markOnly: true }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      setError(data?.error || "Не збереглось");
      await load(month || undefined);
      return;
    }
    setSources((prev) => prev.map((source) => (source.id === id ? { ...source, mark: mark.trim() || null } : source)));
    invalidateLeadSourcesMapCache();
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
    setError("");
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

  const editing = sources.find((source) => source.id === editingId) || null;

  return (
    <div className="w-full px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Джерела</h1>
        <Link href="/admin/direct/stats" className="text-sm link">
          Статистика
        </Link>
        <label className="form-control ml-auto">
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
        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={() => {
            setError("");
            setAddOpen(true);
          }}
        >
          Додати
        </button>
      </div>

      {error && !addOpen && !editing ? <div className="mb-3 text-sm text-red-600">{error}</div> : null}

      <section className="mb-4 overflow-x-auto rounded border">
          <table className="table table-sm w-max min-w-full">
            <thead>
              <tr>
                <th>Джерело</th>
                <th className="min-w-[22rem]">Знак</th>
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
                const canEdit = source.kind === "organic" || canModify;
                const triggers = source.triggerEmojis || [];
                return (
                  <tr key={source.id} className={source.hidden ? "opacity-40" : undefined}>
                    <td className="whitespace-nowrap">
                      {source.name}
                      {source.hidden ? (
                        <span className="ml-1 text-xs text-gray-400" title="Приховано зі списку вибору в ручному призначенні джерела">
                          (приховано)
                        </span>
                      ) : null}
                    </td>
                    <td className="min-w-[22rem]">
                      <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                        <CloudMarkCell
                          sourceId={source.id}
                          mark={source.mark || ""}
                          onCommit={(next) => void saveCloudMark(source.id, next)}
                        />
                        {triggers.length > 0 ? (
                          <span className="text-base leading-none" title="Емодзі в першому повідомленні">
                            {triggers.join(" ")}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">{KIND_LABEL[source.kind]}</td>
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
      </section>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <EmojisPanel sources={sources} onChanged={() => void load(month || undefined)} />
        <AdIdsPanel sources={sources} />
      </div>

      {addOpen ? (
        <EditorWindow
          title="Нове джерело"
          saving={saving}
          error={error}
          saveDisabled={!name.trim()}
          onClose={() => {
            setAddOpen(false);
            setError("");
          }}
          onSave={() => void createSource()}
        >
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
                <span className="label-text text-xs">Знак біля хмарки</span>
                <MarkField value={mark} onChange={setMark} />
              </label>
            ) : null}
          </div>
        </EditorWindow>
      ) : null}

      {editing ? (
        <EditorWindow
          title={editing.name}
          saving={saving}
          error={error}
          saveDisabled={!editName.trim()}
          onClose={cancelEdit}
          onSave={() => void saveEdit()}
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="form-control">
              <span className="label-text text-xs">Назва</span>
              <input className="input input-bordered input-sm" value={editName} onChange={(event) => setEditName(event.target.value)} />
            </label>
            <label className="form-control">
              <span className="label-text text-xs">Тип</span>
              {editKind === "organic" ? (
                <div className="flex h-8 items-center text-sm">{KIND_LABEL.organic}</div>
              ) : (
                <select className="select select-bordered select-sm" value={editKind} onChange={(event) => setEditKind(event.target.value as Kind)}>
                  <option value="ads">Реклама</option>
                  <option value="website">Сайт</option>
                </select>
              )}
            </label>
            <label className="form-control">
              <span className="label-text text-xs">Знак біля хмарки</span>
              <MarkField value={editMark} onChange={setEditMark} />
            </label>
          </div>
        </EditorWindow>
      ) : null}
    </div>
  );
}
