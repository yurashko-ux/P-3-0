"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TEAM_SALON_ROLES } from "@/lib/team/constants";
import { collisionWarningText, findSchemeCollisions, type SchemeRef } from "@/lib/team/scheme-stack";

type SchemeBrief = SchemeRef & { isActive?: boolean };
type MasterOpt = { id: string; name: string; role: string; altegioStaffId: number | null; linked: boolean };
type UserOpt = { id: string; name: string; login: string; linked: boolean };

type MemberRow = {
  id: string;
  name: string;
  salonRole: string;
  altegioStaffId: number | null;
  directMasterId: string | null;
  appUserId: string | null;
  paySchemeId: string | null;
  phone: string | null;
  instagramUsername: string | null;
  telegramUsername: string | null;
  telegramChatId: string | number | null;
  isActive: boolean;
  order: number;
  payScheme: SchemeBrief | null;
  paySchemes?: SchemeBrief[];
  directMaster: { id: string; name: string; role: string; altegioStaffId: number | null } | null;
  appUser: { id: string; name: string; login: string } | null;
};

const ROLE_LABEL: Record<string, string> = {
  master: "Майстер",
  assistant: "Асистент",
  admin: "Адміністратор",
  direct: "Direct",
  other: "Інше",
};

const emptyForm = {
  name: "",
  salonRole: "other",
  altegioStaffId: "",
  directMasterId: "",
  appUserId: "",
  paySchemeIds: [] as string[],
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

export default function TeamPeoplePage() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [masters, setMasters] = useState<MasterOpt[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [schemes, setSchemes] = useState<SchemeBrief[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);

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
      setSchemes(schJson.schemes || []);
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

  const selectedSchemes = useMemo(
    () => schemes.filter((s) => form.paySchemeIds.includes(s.id)),
    [schemes, form.paySchemeIds],
  );
  const formCollision = collisionWarningText(findSchemeCollisions(selectedSchemes));

  function memberSchemes(m: MemberRow): SchemeRef[] {
    if (m.paySchemes && m.paySchemes.length > 0) return m.paySchemes;
    return m.payScheme ? [m.payScheme] : [];
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(m: MemberRow) {
    setEditingId(m.id);
    setForm({
      name: m.name,
      salonRole: m.salonRole,
      altegioStaffId: m.altegioStaffId != null ? String(m.altegioStaffId) : "",
      directMasterId: m.directMasterId || "",
      appUserId: m.appUserId || "",
      paySchemeIds: (m.paySchemes || (m.payScheme ? [m.payScheme] : [])).map((s) => s.id),
      phone: m.phone || "",
      instagramUsername: m.instagramUsername || "",
      telegramUsername: m.telegramUsername || "",
      telegramChatId: m.telegramChatId != null ? String(m.telegramChatId) : "",
      isActive: m.isActive,
      order: m.order,
    });
    setShowForm(true);
  }

  async function saveForm() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        salonRole: form.salonRole,
        altegioStaffId: form.altegioStaffId ? Number(form.altegioStaffId) : null,
        directMasterId: form.directMasterId || null,
        appUserId: form.appUserId || null,
        paySchemeIds: form.paySchemeIds,
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

  async function hideMember(member: MemberRow) {
    if (!confirm(`Приховати «${member.name}»? Людина зникне зі списків CRM. Картку й документи не видаляємо.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/team/members/${member.id}/hide`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не приховано");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка приховування");
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

  return (
    <main className="p-3 space-y-3 max-w-6xl">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Довідник людей салону. Схем ЗП може бути кілька — вони додаються. Звільнених ховаємо в «Архів», не видаляємо.
      </p>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
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

              <label className="form-control">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">Роль</span>
                </span>
                <select
                  className="select select-bordered select-sm h-8 min-h-8"
                  value={form.salonRole}
                  onChange={(e) => setForm((f) => ({ ...f, salonRole: e.target.value }))}
                >
                  {TEAM_SALON_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r] || r}
                    </option>
                  ))}
                </select>
              </label>

              <div className="form-control col-span-2">
                <span className="label py-0 min-h-0">
                  <span className="label-text text-[11px] text-gray-500">Схеми ЗП</span>
                </span>
                <div className="border border-gray-200 rounded-lg max-h-36 overflow-y-auto p-2 space-y-1">
                  {schemes.length === 0 && (
                    <p className="text-xs text-gray-400">Немає схем. Додайте їх у «Схеми ЗП».</p>
                  )}
                  {schemes
                    .filter((s) => s.isActive !== false || form.paySchemeIds.includes(s.id))
                    .map((s) => {
                    const checked = form.paySchemeIds.includes(s.id);
                    return (
                      <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={checked}
                          onChange={() =>
                            setForm((f) => ({
                              ...f,
                              paySchemeIds: checked
                                ? f.paySchemeIds.filter((id) => id !== s.id)
                                : [...f.paySchemeIds, s.id],
                            }))
                          }
                        />
                        <span>{s.title}</span>
                      </label>
                    );
                  })}
                </div>
                {formCollision && <p className="text-[11px] text-amber-700 mt-1">{formCollision}</p>}
              </div>

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
              <th>Роль</th>
              <th>Instagram</th>
              <th>Схема ЗП</th>
              <th>Altegio</th>
              <th>Direct</th>
              <th>Логін</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className={!m.isActive ? "opacity-50" : undefined}>
                <td>{m.name}</td>
                <td>{ROLE_LABEL[m.salonRole] || m.salonRole}</td>
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
                <td>
                  {(() => {
                    const assigned = memberSchemes(m);
                    if (assigned.length === 0) return <span className="text-gray-400">—</span>;
                    const warn = collisionWarningText(findSchemeCollisions(assigned));
                    return (
                      <div className="flex flex-col gap-1 min-w-[9rem] max-w-[16rem] py-1">
                        {assigned.map((s) => (
                          <div
                            key={s.id}
                            className="text-xs leading-snug px-2 py-1 rounded-md border border-gray-200 bg-white"
                          >
                            {s.title}
                          </div>
                        ))}
                        {warn && <div className="text-[11px] text-amber-700">{warn}</div>}
                      </div>
                    );
                  })()}
                </td>
                <td className="tabular-nums text-gray-500">{m.altegioStaffId ?? "—"}</td>
                <td>{m.directMaster?.name || "—"}</td>
                <td>{m.appUser ? `${m.appUser.login}` : "—"}</td>
                <td className="whitespace-nowrap">
                  <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => void hideMember(m)}>
                    Приховати
                  </button>
                </td>
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
