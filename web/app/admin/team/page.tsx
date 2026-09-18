"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TEAM_SALON_ROLES } from "@/lib/team/constants";

type SchemeBrief = { id: string; title: string; kind: string };
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
  telegramUsername: string | null;
  telegramChatId: string | number | null;
  isActive: boolean;
  order: number;
  payScheme: SchemeBrief | null;
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
  paySchemeId: "",
  phone: "",
  telegramUsername: "",
  telegramChatId: "",
  isActive: true,
  order: 0,
};

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
      setSchemes((schJson.schemes || []).filter((s: SchemeBrief & { isActive?: boolean }) => s.isActive !== false));
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
      paySchemeId: m.paySchemeId || "",
      phone: m.phone || "",
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
        paySchemeId: form.paySchemeId || null,
        phone: form.phone || null,
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

  return (
    <main className="p-3 space-y-3 max-w-6xl">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Довідник людей салону: роль, схема нарахування ЗП, звʼязок з Altegio / Direct / логіном. Автонарахування за
        період — пізніше.
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
        <div className="bg-white border rounded-xl p-3 space-y-2 max-w-xl">
          <h2 className="font-semibold text-sm">{editingId ? "Редагувати" : "Нова людина"}</h2>
          <label className="form-control">
            <span className="label-text text-xs">Імʼя</span>
            <input
              className="input input-bordered input-sm"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Роль салону</span>
            <select
              className="select select-bordered select-sm"
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
          <label className="form-control">
            <span className="label-text text-xs">Схема ЗП</span>
            <select
              className="select select-bordered select-sm"
              value={form.paySchemeId}
              onChange={(e) => setForm((f) => ({ ...f, paySchemeId: e.target.value }))}
            >
              <option value="">— без схеми —</option>
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Altegio staff id</span>
            <input
              className="input input-bordered input-sm"
              value={form.altegioStaffId}
              onChange={(e) => setForm((f) => ({ ...f, altegioStaffId: e.target.value }))}
            />
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Direct (майстер)</span>
            <select
              className="select select-bordered select-sm"
              value={form.directMasterId}
              onChange={(e) => setForm((f) => ({ ...f, directMasterId: e.target.value }))}
            >
              <option value="">— не привʼязано —</option>
              {masterOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Логін (AppUser)</span>
            <select
              className="select select-bordered select-sm"
              value={form.appUserId}
              onChange={(e) => setForm((f) => ({ ...f, appUserId: e.target.value }))}
            >
              <option value="">— не привʼязано —</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.login})
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Телефон</span>
            <input
              className="input input-bordered input-sm"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Telegram @username</span>
            <input
              className="input input-bordered input-sm"
              value={form.telegramUsername}
              onChange={(e) => setForm((f) => ({ ...f, telegramUsername: e.target.value }))}
            />
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Telegram chat id</span>
            <input
              className="input input-bordered input-sm"
              value={form.telegramChatId}
              onChange={(e) => setForm((f) => ({ ...f, telegramChatId: e.target.value }))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Активна
          </label>
          <div className="flex gap-2 pt-1">
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void saveForm()}>
              Зберегти
            </button>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setShowForm(false)}>
              Скасувати
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto bg-white border rounded-xl">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>Імʼя</th>
              <th>Роль</th>
              <th>Схема ЗП</th>
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
                <td>{ROLE_LABEL[m.salonRole] || m.salonRole}</td>
                <td>{m.payScheme?.title || "—"}</td>
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
