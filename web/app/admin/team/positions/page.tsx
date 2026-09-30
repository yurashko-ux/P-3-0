"use client";

import { useCallback, useEffect, useState } from "react";
import { getTodayKyivYmd } from "@/lib/team/constants";

type SchemeBrief = { id: string; title: string; kind: string; isActive?: boolean };

type MemberBrief = {
  id: string;
  name: string;
  instagramUsername: string | null;
  isActive: boolean;
};

type PositionRow = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  order: number;
  members?: MemberBrief[];
  ruleVersions?: Array<{
    id: string;
    effectiveFrom: string;
    schemes: Array<{ scheme: SchemeBrief }>;
  }>;
  _count?: { members: number };
};

function schemeTitles(schemes: SchemeBrief[] | undefined): string {
  if (!schemes?.length) return "—";
  return schemes.map((s) => s.title).join(" + ");
}

function MemberAvatar({ member }: { member: MemberBrief }) {
  const [broken, setBroken] = useState(false);
  const username = (member.instagramUsername || "").trim();
  const initials = member.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");

  if (!username || broken) {
    return (
      <div
        className="w-7 h-7 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-[9px] font-semibold text-gray-600 shrink-0"
        title={member.name}
      >
        {initials || "?"}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/admin/direct/instagram-avatar?username=${encodeURIComponent(username)}`}
      alt={member.name}
      title={member.name}
      className="w-7 h-7 rounded-full object-cover border border-gray-200 shrink-0 bg-gray-50"
      onError={() => setBroken(true)}
    />
  );
}

export default function TeamPositionsPage() {
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [schemes, setSchemes] = useState<SchemeBrief[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", order: 100, isActive: true });
  const [schemesPosition, setSchemesPosition] = useState<PositionRow | null>(null);
  const [schemeIds, setSchemeIds] = useState<string[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(getTodayKyivYmd());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [posRes, schRes] = await Promise.all([
        fetch("/api/admin/team/positions?includeInactive=1", { credentials: "include" }),
        fetch("/api/admin/team/schemes", { credentials: "include" }),
      ]);
      const posJson = await posRes.json();
      const schJson = await schRes.json();
      if (!posRes.ok || !posJson.ok) throw new Error(posJson.error || "Помилка посад");
      if (!schRes.ok || !schJson.ok) throw new Error(schJson.error || "Помилка схем");
      setPositions(posJson.positions || []);
      setSchemes((schJson.schemes || []).filter((s: SchemeBrief) => s.isActive !== false));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm({ name: "", order: 100, isActive: true });
    setShowForm(true);
  }

  function openEdit(p: PositionRow) {
    setEditingId(p.id);
    setForm({ name: p.name, order: p.order, isActive: p.isActive });
    setShowForm(true);
  }

  function openSchemes(p: PositionRow) {
    const current = p.ruleVersions?.[0]?.schemes?.map((l) => l.scheme.id) ?? [];
    setSchemesPosition(p);
    setSchemeIds(current);
    setEffectiveFrom(getTodayKyivYmd());
  }

  function toggleScheme(id: string) {
    setSchemeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function saveForm() {
    setBusy(true);
    setError(null);
    try {
      const url = editingId ? `/api/admin/team/positions/${editingId}` : "/api/admin/team/positions";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не збережено посаду");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка посади");
    } finally {
      setBusy(false);
    }
  }

  async function saveSchemes() {
    if (!schemesPosition) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/team/positions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setPaySchemes",
          positionId: schemesPosition.id,
          schemeIds,
          effectiveFrom: effectiveFrom || getTodayKyivYmd(),
          note: `З вкладки Посади «${schemesPosition.name}»`,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не збережено схеми");
      setSchemesPosition(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка схем посади");
    } finally {
      setBusy(false);
    }
  }

  async function removePosition(id: string) {
    if (!confirm("Видалити посаду?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/team/positions/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не видалено");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка видалення посади");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-3 space-y-3 max-w-6xl">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Довідник <strong>посад</strong>. Схеми ЗП можна задати тут (кнопка «Схеми») — вони діють для всіх людей з
        цією посадою. Кілька схем сумуються. «Діє з» зберігає історію.
      </p>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm" disabled={busy} onClick={openCreate}>
          + Посада
        </button>
        <button className="btn btn-sm btn-ghost" disabled={loading} onClick={() => void load()}>
          Оновити
        </button>
      </div>

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
          onClick={() => !busy && setShowForm(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold text-sm">{editingId ? "Редагувати посаду" : "Нова посада"}</h2>
            <label className="form-control">
              <span className="label-text text-[11px] text-gray-500">Назва</span>
              <input
                className="input input-bordered input-sm"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="form-control">
              <span className="label-text text-[11px] text-gray-500">Порядок</span>
              <input
                type="number"
                className="input input-bordered input-sm"
                value={form.order}
                onChange={(e) => setForm((f) => ({ ...f, order: Number(e.target.value) || 0 }))}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              Активна
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setShowForm(false)}>
                Скасувати
              </button>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void saveForm()}>
                Зберегти
              </button>
            </div>
          </div>
        </div>
      )}

      {schemesPosition && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
          onClick={() => !busy && setSchemesPosition(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold text-sm">Схеми ЗП · {schemesPosition.name}</h2>
            <p className="text-[11px] text-gray-500">
              Кілька схем сумуються (І + І). Зміна оновить правило для всіх людей з цією посадою.
            </p>
            <div className="border rounded-lg p-2 max-h-56 overflow-y-auto space-y-1">
              {schemes.length === 0 ? (
                <p className="text-[11px] text-gray-500">Немає активних схем — додайте у «Схеми ЗП».</p>
              ) : (
                schemes.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={schemeIds.includes(s.id)}
                      onChange={() => toggleScheme(s.id)}
                    />
                    <span>{s.title}</span>
                  </label>
                ))
              )}
            </div>
            <label className="form-control">
              <span className="label-text text-[11px] text-gray-500">Діє з</span>
              <input
                type="date"
                className="input input-bordered input-sm"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setSchemesPosition(null)}>
                Скасувати
              </button>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void saveSchemes()}>
                {busy ? "…" : "Зберегти схеми"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto bg-white border rounded-xl">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>Назва</th>
              <th>Людей</th>
              <th>Схеми (поточні)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const schemesNow = p.ruleVersions?.[0]?.schemes?.map((l) => l.scheme) ?? [];
              const members = p.members || [];
              const count = p._count?.members ?? members.length;
              return (
                <tr key={p.id} className={!p.isActive ? "opacity-50" : undefined}>
                  <td>{p.name}</td>
                  <td>
                    <div className="flex items-center gap-2 min-w-[7rem]">
                      <span className="tabular-nums text-xs text-gray-600 w-4 shrink-0">{count}</span>
                      <div className="flex items-center -space-x-1.5">
                        {members.slice(0, 8).map((m) => (
                          <MemberAvatar key={m.id} member={m} />
                        ))}
                        {members.length > 8 && (
                          <div className="w-7 h-7 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-[9px] text-gray-600 shrink-0">
                            +{members.length - 8}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="text-xs max-w-[16rem]">
                    <button
                      type="button"
                      className="text-left hover:underline text-blue-700"
                      onClick={() => openSchemes(p)}
                      title="Редагувати схеми посади"
                    >
                      {schemeTitles(schemesNow)}
                    </button>
                  </td>
                  <td className="whitespace-nowrap">
                    <button className="btn btn-ghost btn-xs" onClick={() => openSchemes(p)}>
                      Схеми
                    </button>
                    <button className="btn btn-ghost btn-xs" onClick={() => openEdit(p)}>
                      Змінити
                    </button>
                    <button
                      className="btn btn-ghost btn-xs text-error"
                      disabled={busy}
                      onClick={() => void removePosition(p.id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && positions.length === 0 && (
          <p className="p-4 text-sm text-gray-500">Немає посад. Натисніть «+ Посада».</p>
        )}
      </div>
    </main>
  );
}
