"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { JournalAppointmentForm, type JournalAppointmentDraft, type JournalMaster, type JournalService } from "./_components/JournalAppointmentForm";

type AppointmentRow = {
  id: string;
  datetime: string;
  seanceLength: number;
  attendance: number | null;
  comment: string | null;
  status: string;
  syncError: string | null;
  masterId: string | null;
  altegioStaffId: number | null;
  staffName: string | null;
  directClientId: string | null;
  lines: Array<{ serviceId: string | null; title: string }>;
  directClient: { id: string; firstName: string | null; lastName: string | null; instagramUsername: string } | null;
  master: { id: string; name: string } | null;
};

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

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8);

function clientName(row: AppointmentRow) {
  const c = row.directClient;
  if (!c) return row.staffName || "Клієнт";
  return [c.lastName, c.firstName].filter(Boolean).join(" ") || c.instagramUsername;
}

export default function JournalDayPage() {
  const [day, setDay] = useState(() => kyivParts(new Date().toISOString()).day);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [masters, setMasters] = useState<JournalMaster[]>([]);
  const [staff, setStaff] = useState<JournalMaster[]>([]);
  const [services, setServices] = useState<JournalService[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  const byStaff = useMemo(() => {
    const map = new Map<string, AppointmentRow[]>();
    for (const row of appointments) {
      const key = row.altegioStaffId != null && row.altegioStaffId > 0 ? String(row.altegioStaffId) : "—";
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [appointments]);

  const openNew = (masterId: string, hour: number) => {
    setDraft({
      masterId,
      datetime: `${day}T${pad(hour)}:00`,
    });
    setFormOpen(true);
  };

  const openExisting = (row: AppointmentRow) => {
    const p = kyivParts(row.datetime);
    setDraft({
      id: row.id,
      directClientId: row.directClientId || undefined,
      clientLabel: clientName(row),
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
        {loading && <span className="text-xs text-gray-500">Завантаження…</span>}
      </div>

      <div className="overflow-x-auto bg-white border rounded-xl">
        <table className="table table-xs">
          <thead>
            <tr>
              <th className="w-14">Час</th>
              {masters.map((m) => (
                <th key={m.id}>
                  <span className="block">{m.name}</span>
                  {m.positionTitle && <span className="block font-normal text-[10px] text-gray-500">{m.positionTitle}</span>}
                </th>
              ))}
              {masters.length === 0 && <th>Немає майстрів у штаті Altegio</th>}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((hour) => (
              <tr key={hour}>
                <td className="tabular-nums text-gray-500">{pad(hour)}:00</td>
                {masters.map((m) => {
                  const rows = (byStaff.get(String(m.altegioStaffId || m.id)) || []).filter((row) => kyivParts(row.datetime).hm.startsWith(pad(hour)));
                  return (
                    <td key={m.id} className="align-top min-w-[140px]">
                      <button type="button" className="btn btn-ghost btn-xs w-full justify-start text-gray-400" onClick={() => openNew(m.id, hour)}>
                        +
                      </button>
                      {rows.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          className={`block w-full text-left text-[11px] rounded px-1 py-0.5 mb-0.5 border ${
                            row.status === "sync_error" ? "border-red-400 bg-red-50" : "border-blue-200 bg-blue-50"
                          }`}
                          title={row.syncError || row.lines.map((l) => l.title).join(", ")}
                          onClick={() => openExisting(row)}
                        >
                          <span className="font-medium">{kyivParts(row.datetime).hm}</span> {clientName(row)}
                          {row.status === "sync_error" ? " !" : ""}
                        </button>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
