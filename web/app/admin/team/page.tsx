"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** Кого ця людина бачить у журналі бота — id інших TeamMember (ручний список, не роль). */
  journalVisibleIds: string[];
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

function TeamPhotoButton({
  memberId,
  instagramUsername,
}: {
  memberId: string;
  instagramUsername: string | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [rev, setRev] = useState(0);
  const [source, setSource] = useState<"custom" | "ig" | "empty">("custom");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ig = (instagramUsername || "").replace(/^@/, "").trim();
  const customSrc = `/api/admin/team/members/${memberId}/avatar?v=${rev}`;
  const igSrc = ig ? `/api/admin/direct/instagram-avatar?username=${encodeURIComponent(ig)}` : null;
  const src = source === "custom" ? customSrc : source === "ig" ? igSrc : null;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const image = await shrinkImageFile(file);
      const res = await fetch(`/api/admin/team/members/${memberId}/avatar`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалось зберегти фото");
      setSource("custom");
      setRev((n) => n + 1);
      console.log("[team] Фото співробітника оновлено", memberId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалось зберегти фото");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        className="w-8 h-8 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center disabled:opacity-60"
        title={src ? "Змінити фото" : "Додати фото"}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className="w-8 h-8 object-cover"
            onError={() => setSource((cur) => (cur === "custom" && igSrc ? "ig" : "empty"))}
          />
        ) : (
          <span className="text-[10px] font-semibold text-gray-400" aria-hidden>
            +
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {error ? <span className="absolute left-0 top-9 z-10 w-40 text-[10px] text-red-600">{error}</span> : null}
    </div>
  );
}

function shrinkImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 256;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Не вдалось обробити фото"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Оберіть jpg або png"));
    };
    img.src = url;
  });
}

/**
 * Колонка «Журнал»: кого ця людина бачить у журналі бота (/master).
 * Ручний список чекбоксів — зберігається одразу при зміні, без ролей/автоматики.
 */
function JournalVisibilityCell({
  member,
  allMembers,
  onSaved,
}: {
  member: MemberRow;
  allMembers: MemberRow[];
  onSaved: (memberId: string, journalVisibleIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, containerRef]);

  async function toggle(targetId: string) {
    const checked = member.journalVisibleIds.includes(targetId);
    const next = checked
      ? member.journalVisibleIds.filter((id) => id !== targetId)
      : [...member.journalVisibleIds, targetId];
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/team/members/${member.id}/journal-visibility`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetIds: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не збережено");
      onSaved(member.id, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  }

  const count = member.journalVisibleIds.length;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        className={`btn btn-xs ${count > 0 ? "btn-outline" : "btn-ghost text-gray-400"}`}
        onClick={() => setOpen((v) => !v)}
      >
        {count > 0 ? `${count} обрано` : "—"}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-xl">
          <p className="mb-1 px-1 text-[10px] text-gray-400">Кого бачить «{member.name}» у боті:</p>
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {allMembers.map((m) => {
              const checked = member.journalVisibleIds.includes(m.id);
              return (
                <label
                  key={m.id}
                  className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs"
                    checked={checked}
                    disabled={saving}
                    onChange={() => void toggle(m.id)}
                  />
                  <span className="truncate">
                    {m.name}
                    {m.id === member.id && <span className="text-gray-400"> (сам)</span>}
                  </span>
                  <span className="ml-auto text-[10px] text-gray-400">{ROLE_LABEL[m.salonRole] || m.salonRole}</span>
                </label>
              );
            })}
          </div>
          {error && <p className="mt-1 px-1 text-[10px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Колонка «Telegram»: username + chat id для прив'язки до бота /master.
 * Швидке редагування прямо в таблиці — без відкриття повної форми.
 */
function TelegramCell({
  member,
  onSaved,
}: {
  member: MemberRow;
  onSaved: (memberId: string, telegramUsername: string | null, telegramChatId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(member.telegramUsername || "");
  const [chatId, setChatId] = useState(member.telegramChatId != null ? String(member.telegramChatId) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsername(member.telegramUsername || "");
    setChatId(member.telegramChatId != null ? String(member.telegramChatId) : "");
  }, [open, member.telegramUsername, member.telegramChatId]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/team/members/${member.id}/telegram`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramUsername: username.trim() || null,
          telegramChatId: chatId.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не збережено");
      onSaved(member.id, json.member.telegramUsername, json.member.telegramChatId);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  }

  const linked = Boolean(member.telegramChatId);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        className={`btn btn-xs ${member.telegramUsername ? "btn-outline" : "btn-ghost text-gray-400"}`}
        onClick={() => setOpen((v) => !v)}
        title={linked ? "Прив'язано до бота" : "Username задано, але бот ще не прив'язав chat id"}
      >
        {member.telegramUsername ? `@${member.telegramUsername}` : "Додати"}
        {member.telegramUsername && <span className="ml-1">{linked ? "✅" : "⏳"}</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-xl space-y-1.5">
          <label className="form-control">
            <span className="label py-0 min-h-0">
              <span className="label-text text-[10px] text-gray-500">Telegram username</span>
            </span>
            <input
              className="input input-bordered input-xs h-7"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="form-control">
            <span className="label py-0 min-h-0">
              <span className="label-text text-[10px] text-gray-500">Telegram chat id</span>
            </span>
            <input
              className="input input-bordered input-xs h-7"
              placeholder="заповнюється ботом автоматично"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
            />
          </label>
          {error && <p className="px-0.5 text-[10px] text-red-600">{error}</p>}
          <div className="flex justify-end gap-1 pt-0.5">
            <button className="btn btn-ghost btn-xs" disabled={saving} onClick={() => setOpen(false)}>
              Скасувати
            </button>
            <button className="btn btn-primary btn-xs" disabled={saving} onClick={() => void save()}>
              {saving ? "…" : "Зберегти"}
            </button>
          </div>
        </div>
      )}
    </div>
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
    <main className="p-3 space-y-3">
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
        <table className="table table-xs w-full">
          <thead>
            <tr>
              <th>Імʼя</th>
              <th>Роль</th>
              <th>Instagram</th>
              <th className="min-w-[18rem]">Схема ЗП</th>
              <th>Altegio</th>
              <th>Direct</th>
              <th>Логін</th>
              <th>Telegram</th>
              <th>Журнал</th>
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
                  <div className="flex items-center gap-2 min-w-[8rem]">
                    <TeamPhotoButton memberId={m.id} instagramUsername={m.instagramUsername} />
                    {m.instagramUsername ? (
                      <span className="text-xs truncate" title={m.instagramUsername}>
                        {m.instagramUsername}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </div>
                </td>
                <td>
                  {(() => {
                    const assigned = memberSchemes(m);
                    if (assigned.length === 0) return <span className="text-gray-400">—</span>;
                    const warn = collisionWarningText(findSchemeCollisions(assigned));
                    return (
                      <div className="flex flex-col items-start gap-1 py-1">
                        {assigned.map((s) => (
                          <div
                            key={s.id}
                            className="text-xs leading-none whitespace-nowrap px-2 py-1.5 rounded-md border border-gray-200 bg-white"
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
                <td>
                  <TelegramCell
                    member={m}
                    onSaved={(memberId, telegramUsername, telegramChatId) =>
                      setMembers((prev) =>
                        prev.map((row) =>
                          row.id === memberId ? { ...row, telegramUsername, telegramChatId } : row,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <JournalVisibilityCell
                    member={m}
                    allMembers={members}
                    onSaved={(memberId, journalVisibleIds) =>
                      setMembers((prev) =>
                        prev.map((row) => (row.id === memberId ? { ...row, journalVisibleIds } : row)),
                      )
                    }
                  />
                </td>
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
