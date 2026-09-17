"use client";

import { useCallback, useEffect, useState } from "react";
import { JournalAppointmentForm, type JournalAppointmentDraft, type JournalMaster, type JournalService } from "./_components/JournalAppointmentForm";
import { JournalDayGrid, clientLabelOf, type JournalGridAppointment } from "./_components/JournalDayGrid";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function kyivParts(iso: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    hm: `${get("hour")}:${get("minute")}`,
    datetimeLocal: `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`,
  };
}

function shiftDay(day: string, delta: number) {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta, 12));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export default function JournalDayPage() {
  const [day, setDay] = useState(() => kyivParts(new Date().toISOString()).day);
  const [appointments, setAppointments] = useState<JournalGridAppointment[]>([]);
  const [masters, setMasters] = useState<JournalMaster[]>([]);
  const [staff, setStaff] = useState<JournalMaster[]>([]);
  const [services, setServices] = useState<JournalService[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [draft, setDraft] = useState<JournalAppointmentDraft | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async (ymd: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/journal/appointments?day=${ymd}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка журналу");
      setAppointments(json.appointments || []);
      setMasters(json.masters || []);
      setStaff(json.staff || json.masters || []);
      setServices(json.services || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(day);
  }, [day, load]);

  const syncFromAltegio = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/journal/sync", { method: "POST", credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка синхронізації");
      const n = json.result?.upserted ?? json.result?.count ?? 0;
      setNotice(`Підтягнуто з Altegio: ${n} записів (${json.result?.startDate}…${json.result?.endDate})`);
      await load(day);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка синхронізації");
    } finally {
      setSyncing(false);
    }
  };

  const openNew = (masterId: string, datetimeLocal: string) => {
    setDraft({
      masterId,
      datetime: datetimeLocal,
    });
    setFormOpen(true);
  };

  const openExisting = (row: JournalGridAppointment) => {
    const p = kyivParts(row.datetime);
    setDraft({
      id: row.id,
      directClientId: row.directClient?.id || undefined,
      clientLabel: clientLabelOf(row),
      masterId: row.altegioStaffId ? String(row.altegioStaffId) : row.masterId || undefined,
      datetime: p.datetimeLocal,
      seanceLength: row.seanceLength,
      comment: row.comment || "",
      attendance: row.attendance ?? 0,
      serviceIds: row.lines.map((l) => l.serviceId).filter(Boolean) as string[],
    });
    setFormOpen(true);
  };

  return (
    <main className="p-3 space-y-3">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Записи дублюються з Altegio. Створення / перенос / скасування з Kresco одразу пише в журнал Altegio. Каса й оплата поки там.
      </p>
      {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" onClick={() => setDay((d) => shiftDay(d, -1))}>←</button>
        <input className="input input-bordered input-sm" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button className="btn btn-sm" onClick={() => setDay((d) => shiftDay(d, 1))}>→</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setDay(kyivParts(new Date().toISOString()).day)}>Сьогодні</button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            setDraft({});
            setFormOpen(true);
          }}
        >
          Записати
        </button>
        <button className="btn btn-sm" disabled={syncing} onClick={() => void syncFromAltegio()}>
          {syncing ? "Синхронізація…" : "Підтягнути з Altegio"}
        </button>
        {loading && <span className="text-xs text-gray-500">Завантаження…</span>}
      </div>

      <JournalDayGrid
        day={day}
        masters={masters}
        appointments={appointments}
        loading={loading}
        onEmptySlot={openNew}
        onAppointment={openExisting}
      />

      <JournalAppointmentForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => void load(day)}
        masters={staff}
        services={services}
        draft={draft}
      />
    </main>
  );
}
