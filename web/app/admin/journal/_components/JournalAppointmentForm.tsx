"use client";

import { useEffect, useState } from "react";

export type JournalService = {
  id: string;
  title: string;
  kind: string;
  durationSec: number;
  altegioServiceId: number;
};

export type JournalMaster = {
  id: string;
  name: string;
  altegioStaffId: number | null;
  positionTitle?: string;
  positionKind?: string;
};

export type JournalClient = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  instagramUsername: string;
  altegioClientId?: number | null;
};

export type JournalAppointmentDraft = {
  id?: string;
  directClientId?: string;
  clientLabel?: string;
  altegioClientId?: number | null;
  masterId?: string;
  datetime?: string;
  seanceLength?: number;
  comment?: string;
  attendance?: number;
  serviceIds?: string[];
};

function clientLabel(c: JournalClient) {
  return [c.lastName, c.firstName].filter(Boolean).join(" ") || c.instagramUsername;
}

function kyivDatetimeLocalNow() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function kyivDayNow() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(new Date());
}

export function JournalAppointmentForm({
  open,
  onClose,
  onSaved,
  masters,
  services,
  draft,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  masters: JournalMaster[];
  services: JournalService[];
  draft: JournalAppointmentDraft | null;
}) {
  const [directClientId, setDirectClientId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientHits, setClientHits] = useState<JournalClient[]>([]);
  const [clientPicked, setClientPicked] = useState("");
  const [masterId, setMasterId] = useState("");
  const [datetime, setDatetime] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [attendance, setAttendance] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogMasters, setCatalogMasters] = useState<JournalMaster[]>(masters);
  const [catalogServices, setCatalogServices] = useState<JournalService[]>(services);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDirectClientId(draft?.directClientId || "");
    setClientPicked(draft?.clientLabel || "");
    setClientQuery("");
    setClientHits([]);
    setDatetime(draft?.datetime || kyivDatetimeLocalNow());
    setServiceIds(draft?.serviceIds || []);
    setComment(draft?.comment || "");
    setAttendance(draft?.attendance ?? 0);
    if (draft?.directClientId && !(draft.altegioClientId && draft.altegioClientId > 0)) {
      setError("У клієнта немає id Altegio — запис у журнал неможливий");
    }
  }, [open, draft]);

  useEffect(() => {
    if (!open) return;
    if (masters.length > 0 && services.length > 0) {
      setCatalogMasters(masters);
      setCatalogServices(services);
      return;
    }
    void fetch(`/api/admin/journal/appointments?day=${kyivDayNow()}`, { credentials: "include" })
      .then((r) => r.json())
      .then((json) => {
        if (!json?.ok) throw new Error(json?.error || "Не вдалося завантажити довідник журналу");
        setCatalogMasters(masters.length > 0 ? masters : json.staff || json.masters || []);
        setCatalogServices(services.length > 0 ? services : json.services || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Помилка довідника"));
  }, [open, masters, services]);

  useEffect(() => {
    if (!open) return;
    setMasterId(draft?.masterId || catalogMasters[0]?.id || "");
  }, [open, draft, catalogMasters]);

  useEffect(() => {
    if (!open || clientQuery.trim().length < 1 || draft?.directClientId) return;
    const t = setTimeout(() => {
      void fetch(`/api/admin/journal/clients?q=${encodeURIComponent(clientQuery)}`, { credentials: "include" })
        .then((r) => r.json())
        .then((json) => setClientHits(json.clients || []));
    }, 250);
    return () => clearTimeout(t);
  }, [clientQuery, open, draft?.directClientId]);

  if (!open) return null;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        directClientId,
        masterId,
        datetime,
        comment,
        attendance,
        serviceIds,
      };
      const url = draft?.id ? `/api/admin/journal/appointments/${draft.id}` : "/api/admin/journal/appointments";
      const res = await fetch(url, {
        method: draft?.id ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка запису");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  };

  const cancelAppt = async () => {
    if (!draft?.id) return;
    if (!confirm("Скасувати запис у Kresco і Altegio?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/journal/appointments/${draft.id}`, { method: "DELETE", credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка скасування");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  };

  const toggleService = (id: string) => {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl border w-full max-w-lg p-3 space-y-2 my-6" onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold">{draft?.id ? "Запис" : "Новий запис"}</p>
        <p className="text-[11px] text-gray-500">Пишеться в Kresco і одразу в журнал Altegio.</p>
        {error && <div className="alert alert-error text-sm py-2">{error}</div>}

        <label className="text-xs text-gray-600 block space-y-1">
          <span>Клієнт</span>
          {draft?.directClientId ? (
            <input className="input input-bordered input-sm w-full" value={clientPicked} readOnly />
          ) : (
            <div>
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Імʼя, нік, телефон…"
                value={clientQuery}
                onChange={(e) => setClientQuery(e.target.value)}
              />
              {clientPicked && <p className="text-xs mt-1">{clientPicked}</p>}
              {clientHits.length > 0 && (
                <ul className="menu bg-base-100 border rounded-md mt-1 max-h-40 overflow-auto text-xs">
                  {clientHits.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setDirectClientId(c.id);
                          setClientPicked(clientLabel(c));
                          setClientHits([]);
                          setClientQuery("");
                        }}
                      >
                        {clientLabel(c)} · {c.instagramUsername}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </label>

        <label className="text-xs text-gray-600 block space-y-1">
          <span>Працівник</span>
          <select className="select select-bordered select-sm w-full" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
            {catalogMasters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.positionTitle ? ` · ${m.positionTitle}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-gray-600 block space-y-1">
          <span>Дата і час</span>
          <input className="input input-bordered input-sm w-full" type="datetime-local" value={datetime} onChange={(e) => setDatetime(e.target.value)} />
        </label>

        <div className="text-xs text-gray-600 space-y-1">
          <span>Послуги</span>
          <div className="max-h-40 overflow-auto border rounded-md p-1 space-y-0.5">
            {catalogServices.map((s) => (
              <label key={s.id} className="flex items-center gap-2 px-1 py-0.5">
                <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                <span>{s.title}</span>
                <span className="text-gray-400 ml-auto">{s.kind}</span>
              </label>
            ))}
            {catalogServices.length === 0 && <p className="p-2 text-gray-500">Немає послуг. Імпортуйте в розділі Послуги.</p>}
          </div>
        </div>

        <label className="text-xs text-gray-600 block space-y-1">
          <span>Прихід</span>
          <select className="select select-bordered select-sm w-full" value={attendance} onChange={(e) => setAttendance(Number(e.target.value))}>
            <option value={0}>очікування</option>
            <option value={2}>підтверджено</option>
            <option value={1}>прийшов</option>
            <option value={-1}>не прийшов</option>
          </select>
        </label>

        <textarea className="textarea textarea-bordered textarea-sm w-full" placeholder="Коментар" value={comment} onChange={(e) => setComment(e.target.value)} />

        <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm btn-primary" disabled={saving} onClick={() => void submit()}>
            {saving ? "Збереження…" : draft?.id ? "Зберегти" : "Записати"}
          </button>
          {draft?.id && (
            <button className="btn btn-sm btn-error btn-outline" disabled={saving} onClick={() => void cancelAppt()}>Скасувати запис</button>
          )}
          <button className="btn btn-sm btn-ghost" onClick={onClose}>Закрити</button>
        </div>
      </div>
    </div>
  );
}
