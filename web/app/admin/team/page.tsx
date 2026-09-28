"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getTodayKyivYmd } from "@/lib/team/constants";

type SchemeBrief = { id: string; title: string; kind: string; isActive?: boolean };
type MasterOpt = { id: string; name: string; role: string; altegioStaffId: number | null; linked: boolean };
type UserOpt = { id: string; name: string; login: string; linked: boolean };

type PositionRow = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  order: number;
  ruleVersions?: Array<{
    id: string;
    effectiveFrom: string;
    schemes: Array<{ scheme: SchemeBrief }>;
  }>;
  _count?: { members: number };
};

type MemberRow = {
  id: string;
  name: string;
  salonRole: string;
  positionId: string | null;
  position: { id: string; name: string; code: string | null } | null;
  altegioStaffId: number | null;
  directMasterId: string | null;
  appUserId: string | null;
  phone: string | null;
  instagramUsername: string | null;
  telegramUsername: string | null;
  telegramChatId: string | number | null;
  isActive: boolean;
  order: number;
  paySchemeIds?: string[];
  currentPayAssignment?: {
    id: string;
    effectiveFrom: string;
    schemes: SchemeBrief[];
  } | null;
  directMaster: { id: string; name: string; role: string; altegioStaffId: number | null } | null;
  appUser: { id: string; name: string; login: string } | null;
};

const emptyForm = {
  name: "",
  positionId: "",
  altegioStaffId: "",
  directMasterId: "",
  appUserId: "",
  paySchemeIds: [] as string[],
  effectiveFrom: getTodayKyivYmd(),
  phone: "",
  instagramUsername: "",
  telegramUsername: "",
  telegramChatId: "",
  isActive: true,
  order: 0,
};

function TeamIgAvatar({ username }: { username: string }) {
  const [broken, setBroken] = useState(false);
  const src = `/api/admin/direct/instagram-avatar?username=${encodeURIComponent(username)}`;
  if (broken) {
    return (
      <div className="w-8 h-8 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-[10px] font-semibold text-gray-500 shrink-0">
        IG
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="w-8 h-8 rounded-lg object-cover border border-gray-200 shrink-0 bg-gray-50"
      onError={() => setBroken(true)}
    />
  );
}

function schemeTitles(schemes: SchemeBrief[] | undefined): string {
  if (!schemes?.length) return "—";
  return schemes.map((s) => s.title).join(" + ");
}

export default function TeamPeoplePage() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [masters, setMasters] = useState<MasterOpt[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [schemes, setSchemes] = useState<SchemeBrief[]>([]);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [showPositionForm, setShowPositionForm] = useState(false);
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [positionForm, setPositionForm] = useState({ name: "", order: 100, isActive: true });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [memRes, schRes] = await Promise.all([
        fetch("/api/admin/team/members", { credentials: "include" }),
        fetch("/api/admin/team/schemes", { credentials: "include" }),
      ]);
      const memJson = await memRes.json();
      const schJson = await schRes.json();
      if (!memRes.ok || !memJson.ok) throw new Error(memJson.error || "Помилка людей");
      if (!schRes.ok || !schJson.ok) throw new Error(schJson.error || "Помилка схем");
      setMembers(memJson.members || []);
      setMasters(memJson.masters || []);
      setUsers(memJson.users || []);
      setPositions(memJson.positions || []);
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

  const masterOptions = useMemo(() => {
    return masters.filter((m) => !m.linked || m.id === form.directMasterId);
  }, [masters, form.directMasterId]);

  const userOptions = useMemo(() => {
    return users.filter((u) => !u.linked || u.id === form.appUserId);
  }, [users, form.appUserId]);

  const activePositions = useMemo(
    () => positions.filter((p) => p.isActive || p.id === form.positionId),
    [positions, form.positionId],
  );

  function schemesForPosition(positionId: string): string[] {
    const pos = positions.find((p) => p.id === positionId);
    const version = pos?.ruleVersions?.[0];
    return version?.schemes?.map((link) => link.scheme.id) ?? [];
  }

  function openCreate() {
    setEditingId(null);
    const defaultPositionId = positions.find((p) => p.code === "other")?.id || positions[0]?.id || "";
    setForm({
      ...emptyForm,
      positionId: defaultPositionId,
      paySchemeIds: defaultPositionId ? schemesForPosition(defaultPositionId) : [],
      effectiveFrom: getTodayKyivYmd(),
    });
    setShowForm(true);
  }

  function openEdit(m: MemberRow) {
    setEditingId(m.id);
    const positionId = m.positionId || m.position?.id || "";
    setForm({
      name: m.name,
      positionId,
      altegioStaffId: m.altegioStaffId != null ? String(m.altegioStaffId) : "",
      directMasterId: m.directMasterId || "",
      appUserId: m.appUserId || "",
      paySchemeIds: m.paySchemeIds?.length
        ? [...m.paySchemeIds]
        : m.currentPayAssignment?.schemes?.map((s) => s.id) || schemesForPosition(positionId),
      effectiveFrom: getTodayKyivYmd(),
      phone: m.phone || "",
      instagramUsername: m.instagramUsername || "",
      telegramUsername: m.telegramUsername || "",
      telegramChatId: m.telegramChatId != null ? String(m.telegramChatId) : "",
      isActive: m.isActive,
      order: m.order,
    });
    setShowForm(true);
  }

  function toggleScheme(schemeId: string) {
    setForm((f) => {
      const has = f.paySchemeIds.includes(schemeId);
      return {
        ...f,
        paySchemeIds: has ? f.paySchemeIds.filter((id) => id !== schemeId) : [...f.paySchemeIds, schemeId],
      };
    });
  }

  function onPositionChange(positionId: string) {
    setForm((f) => ({
      ...f,
      positionId,
      paySchemeIds: schemesForPosition(positionId),
    }));
  }

  async function saveForm() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        positionId: form.positionId || null,
        altegioStaffId: form.altegioStaffId ? Number(form.altegioStaffId) : null,
        directMasterId: form.directMasterId || null,
        appUserId: form.appUserId || null,
        paySchemeIds: form.paySchemeIds,
        effectiveFrom: form.effectiveFrom || getTodayKyivYmd(),
        phone: form.phone || null,
        instagramUsername: form.instagramUsername || null,
        telegramUsername: form.telegramUsername || null,
        telegramChatId: form.telegramChatId || null,
        isActive: form.isActive,
        order: form.order,
      };
      const url = editingId ? `/api/admin/team/members/${editingId}` : "/api/admin/team/members";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не збережено");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(id: string) {
    if (!confirm("Видалити картку людини?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/team/members/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не видалено");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка видалення");
    } finally {
      setBusy(false);
    }
  }

  async function importAltegio() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/team/members/import-altegio", {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Імпорт не вдався");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка імпорту");
    } finally {
      setBusy(false);
    }
  }

  function openCreatePosition() {
    setEditingPositionId(null);
    setPositionForm({ name: "", order: 100, isActive: true });
    setShowPositionForm(true);
  }

  function openEditPosition(p: PositionRow) {
    setEditingPositionId(p.id);
    setPositionForm({ name: p.name, order: p.order, isActive: p.isActive });
    setShowPositionForm(true);
  }

  async function savePosition() {
    setBusy(true);
    setError(null);
    try {
      const url = editingPositionId
        ? `/api/admin/team/positions/${editingPositionId}`
        : "/api/admin/team/positions";
      const res = await fetch(url, {
        method: editingPositionId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(positionForm),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не збережено посаду");
      setShowPositionForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка посади");
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
        Люди салону: <strong>посада</strong> і <strong>схеми ЗП</strong> (кілька схем сумуються). Зміна схем у
        формі людини оновлює правило цієї посади для <strong>всіх</strong> з тією ж посадою. «Діє з» — історія, минуле
        не перераховуємо. Автонарахування — пізніше.
      </p>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}

      <section className="bg-white border rounded-xl p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Посади</h2>
          <button className="btn btn-xs" disabled={busy} onClick={openCreatePosition}>
            + Посада
          </button>
        </div>
        <div className="overflow-x-auto">
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
                return (
                  <tr key={p.id} className={!p.isActive ? "opacity-50" : undefined}>
                    <td>{p.name}</td>
                    <td className="tabular-nums">{p._count?.members ?? 0}</td>
                    <td className="text-xs">{schemeTitles(schemesNow)}</td>
                    <td className="whitespace-nowrap">
                      <button className="btn btn-ghost btn-xs" onClick={() => openEditPosition(p)}>
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
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm btn-primary" disabled={busy || loading} onClick={() => void importAltegio()}>
          Підтягнути з Altegio
        </button>
        <button className="btn btn-sm" disabled={busy} onClick={openCreate}>
          Додати людину
        </button>
        <button className="btn btn-sm btn-ghost" disabled={loading} onClick={() => void load()}>
          Оновити
        </button>
      </div>

      {showPositionForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
          onClick={() => !busy && setShowPositionForm(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold text-sm">{editingPositionId ? "Редагувати посаду" : "Нова посада"}</h2>
            <label className="form-control">
              <span className="label-text text-[11px] text-gray-500">Назва</span>
              <input
                className="input input-bordered input-sm"
                value={positionForm.name}
                onChange={(e) => setPositionForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="form-control">
              <span className="label-text text-[11px] text-gray-500">Порядок</span>
              <input
                type="number"
                className="input input-bordered input-sm"
                value={positionForm.order}
                onChange={(e) => setPositionForm((f) => ({ ...f, order: Number(e.target.value) || 0 }))}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={positionForm.isActive}
                onChange={(e) => setPositionForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              Активна
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setShowPositionForm(false)}>
                Скасувати
              </button>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void savePosition()}>
                Зберегти
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
          onClick={() => !busy && setShowForm(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-4 space-y-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-sm">{editingId ? "Редагувати" : "Нова людина"}</h2>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-circle"
                disabled={busy}
                onClick={() => setShowForm(false)}
                aria-label="Закрити"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-x-2 gap-y-2">
              <label className="form-control col-span-2">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">Імʼя</span>
                </span>
                <input
                  className="input input-bordered input-sm h-8"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>

              <label className="form-control col-span-2">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">Посада</span>
                </span>
                <select
                  className="select select-bordered select-sm h-8 min-h-8"
                  value={form.positionId}
                  onChange={(e) => onPositionChange(e.target.value)}
                >
                  <option value="">—</option>
                  {activePositions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="form-control col-span-2">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">
                    Схеми ЗП (сумуються; зміна = правило посади для всіх)
                  </span>
                </span>
                <div className="border rounded-lg p-2 max-h-36 overflow-y-auto space-y-1">
                  {schemes.length === 0 ? (
                    <p className="text-[11px] text-gray-500">Немає активних схем — додайте в «Схеми ЗП».</p>
                  ) : (
                    schemes.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={form.paySchemeIds.includes(s.id)}
                          onChange={() => toggleScheme(s.id)}
                        />
                        <span>{s.title}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <label className="form-control col-span-2">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">Діє з (дата правила)</span>
                </span>
                <input
                  type="date"
                  className="input input-bordered input-sm h-8"
                  value={form.effectiveFrom}
                  onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
                />
              </label>

              <label className="form-control">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">Altegio id</span>
                </span>
                <input
                  className="input input-bordered input-sm h-8"
                  value={form.altegioStaffId}
                  onChange={(e) => setForm((f) => ({ ...f, altegioStaffId: e.target.value }))}
                />
              </label>

              <label className="form-control">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">Instagram</span>
                </span>
                <input
                  className="input input-bordered input-sm h-8"
                  placeholder="halyna.maksymiv"
                  value={form.instagramUsername}
                  onChange={(e) => setForm((f) => ({ ...f, instagramUsername: e.target.value }))}
                />
              </label>

              <label className="form-control">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">Direct</span>
                </span>
                <select
                  className="select select-bordered select-sm h-8 min-h-8"
                  value={form.directMasterId}
                  onChange={(e) => setForm((f) => ({ ...f, directMasterId: e.target.value }))}
                >
                  <option value="">—</option>
                  {masterOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-control">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">Логін</span>
                </span>
                <select
                  className="select select-bordered select-sm h-8 min-h-8"
                  value={form.appUserId}
                  onChange={(e) => setForm((f) => ({ ...f, appUserId: e.target.value }))}
                >
                  <option value="">—</option>
                  {userOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.login})
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-control">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">Телефон</span>
                </span>
                <input
                  className="input input-bordered input-sm h-8"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </label>

              <label className="form-control">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">Telegram</span>
                </span>
                <input
                  className="input input-bordered input-sm h-8"
                  placeholder="@username"
                  value={form.telegramUsername}
                  onChange={(e) => setForm((f) => ({ ...f, telegramUsername: e.target.value }))}
                />
              </label>

              <label className="form-control col-span-2">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">Telegram chat id</span>
                </span>
                <input
                  className="input input-bordered input-sm h-8"
                  value={form.telegramChatId}
                  onChange={(e) => setForm((f) => ({ ...f, telegramChatId: e.target.value }))}
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs pt-0.5">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              Активна
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setShowForm(false)}>
                Скасувати
              </button>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void saveForm()}>
                {busy ? "…" : "Зберегти"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto bg-white border rounded-xl">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>Імʼя</th>
              <th>Посада</th>
              <th>Instagram</th>
              <th>Схеми ЗП</th>
              <th>Altegio</th>
              <th>Direct</th>
              <th>Логін</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className={!m.isActive ? "opacity-50" : undefined}>
                <td>{m.name}</td>
                <td>{m.position?.name || "—"}</td>
                <td>
                  {m.instagramUsername ? (
                    <div className="flex items-center gap-2 min-w-[8rem]">
                      <TeamIgAvatar username={m.instagramUsername} />
                      <span className="text-xs truncate" title={m.instagramUsername}>
                        {m.instagramUsername}
                      </span>
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="text-xs max-w-[14rem]">
                  {schemeTitles(m.currentPayAssignment?.schemes)}
                </td>
                <td className="tabular-nums text-gray-500">{m.altegioStaffId ?? "—"}</td>
                <td>{m.directMaster?.name || "—"}</td>
                <td>{m.appUser ? `${m.appUser.login}` : "—"}</td>
                <td className="whitespace-nowrap">
                  <button className="btn btn-ghost btn-xs" onClick={() => openEdit(m)}>
                    Змінити
                  </button>
                  <button className="btn btn-ghost btn-xs text-error" disabled={busy} onClick={() => void removeMember(m.id)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && members.length === 0 && (
          <p className="p-4 text-sm text-gray-500">Порожньо. Натисніть «Підтягнути з Altegio».</p>
        )}
      </div>
    </main>
  );
}
