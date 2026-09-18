"use client";

import { useCallback, useEffect, useState } from "react";
import { JournalAppointmentForm, type JournalAppointmentDraft, type JournalMaster, type JournalService } from "./_components/JournalAppointmentForm";
import { JournalCheckoutModal } from "./_components/JournalCheckoutModal";
import { JournalDayGrid, clientLabelOf, type JournalGridAppointment } from "./_components/JournalDayGrid";
import { useJournalDay } from "./_components/JournalDayContext";
import { JournalTopToolbar } from "./_components/JournalTopToolbar";

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

export default function JournalDayPage() {
  const { day, viewMode, setSidebarActions } = useJournalDay();
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
  const [checkoutId, setCheckoutId] = useState<string | null>(null);

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

  const syncFromAltegio = useCallback(async () => {
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
  }, [day, load]);

  const openBookForm = useCallback(() => {
    setDraft({});
    setFormOpen(true);
  }, []);

  useEffect(() => {
    setSidebarActions({
      onBook: openBookForm,
      onSync: () => {
        void syncFromAltegio();
      },
      syncing,
    });
    return () => setSidebarActions({});
  }, [setSidebarActions, openBookForm, syncFromAltegio, syncing]);

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
      altegioRecordId: row.altegioRecordId ?? null,
      masterId: row.altegioStaffId ? String(row.altegioStaffId) : row.masterId || undefined,
      datetime: p.datetimeLocal,
      seanceLength: row.seanceLength,
      comment: row.comment || "",
      attendance: row.attendance ?? 0,
      serviceIds: row.lines.map((l) => l.serviceId).filter(Boolean) as string[],
      checkoutStatus: row.checkout?.status || null,
      paidAmount: row.checkout?.paidAmount ?? null,
    });
    setFormOpen(true);
  };

  return (
    <>
      <JournalTopToolbar />
      <main className="p-2 space-y-2 flex-1 min-h-0">
        {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}
        {error && <div className="alert alert-error text-sm py-2">{error}</div>}
        {loading && <p className="text-xs text-gray-500 px-1">Завантаження…</p>}

        {viewMode === "week" ? (
          <div className="bg-white border rounded-xl px-4 py-8 text-sm text-gray-600 text-center">
            Тижневий режим сітки — наступний крок. Поки користуйтесь переглядом «День».
          </div>
        ) : (
          <JournalDayGrid
            day={day}
            masters={masters}
            appointments={appointments}
            loading={loading}
            onEmptySlot={openNew}
            onAppointment={openExisting}
          />
        )}

        <JournalAppointmentForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          onSaved={() => void load(day)}
          masters={staff}
          services={services}
          draft={draft}
          onCheckout={(id) => setCheckoutId(id)}
        />

        <JournalCheckoutModal
          open={Boolean(checkoutId)}
          appointmentId={checkoutId}
          onClose={() => setCheckoutId(null)}
          onDone={() => {
            setCheckoutId(null);
            void load(day);
          }}
        />
      </main>
    </>
  );
}
