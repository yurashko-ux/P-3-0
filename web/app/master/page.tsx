"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterAppointmentCard } from "./_components/MasterAppointmentCard";
import { MasterAppointmentDetail } from "./_components/MasterAppointmentDetail";
import type { MasterAppointment } from "./_components/types";
import { formatKyivDayLabel, kyivTodayYmd, shiftKyivDay } from "./_lib/kyiv-day";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
      };
    };
  }
}

/** Чекає появу Telegram WebApp SDK (скрипт у layout.tsx) до WAIT_MS, інакше вважаємо, що відкрито поза Telegram. */
function waitForTelegramInitData(timeoutMs = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const initData = window.Telegram?.WebApp?.initData;
      if (initData) {
        window.Telegram?.WebApp?.ready?.();
        window.Telegram?.WebApp?.expand?.();
        resolve(initData);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

export default function MasterJournalPage() {
  const [initData, setInitData] = useState<string | null>(null);
  const [initDataChecked, setInitDataChecked] = useState(false);
  const [day, setDay] = useState(() => kyivTodayYmd());
  const [masterName, setMasterName] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<MasterAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MasterAppointment | null>(null);

  useEffect(() => {
    void waitForTelegramInitData().then((data) => {
      setInitData(data);
      setInitDataChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!initDataChecked) return;
    if (!initData) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/master/appointments?day=${encodeURIComponent(day)}`, {
      headers: { "x-telegram-init-data": initData },
      cache: "no-store",
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося завантажити журнал");
        if (cancelled) return;
        setMasterName(json.masterName || null);
        setAppointments(json.appointments || []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Помилка завантаження");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initData, initDataChecked, day]);

  const dayLabel = useMemo(() => formatKyivDayLabel(day), [day]);
  const isToday = day === kyivTodayYmd();

  if (initDataChecked && !initData) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-sm text-gray-600">
          Відкрийте журнал через кнопку «Мій журнал» у Telegram-боті, а не напряму в браузері.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-3 pb-6 pt-4">
      <header className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setDay((d) => shiftKyivDay(d, -1))}
          className="rounded-full px-3 py-1.5 text-sm text-slate-600 active:scale-95"
          aria-label="Попередній день"
        >
          ←
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold text-gray-900">{isToday ? "Сьогодні" : dayLabel}</div>
          {masterName && <div className="text-[11px] text-gray-500">{masterName}</div>}
        </div>
        <button
          type="button"
          onClick={() => setDay((d) => shiftKyivDay(d, 1))}
          className="rounded-full px-3 py-1.5 text-sm text-slate-600 active:scale-95"
          aria-label="Наступний день"
        >
          →
        </button>
      </header>

      {loading && <p className="py-10 text-center text-sm text-gray-500">Завантаження…</p>}
      {error && (
        <div className="mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {!loading && !error && appointments.length === 0 && (
        <p className="py-10 text-center text-sm text-gray-500">На цей день записів немає.</p>
      )}

      <div className="mx-auto flex max-w-md flex-col gap-2">
        {appointments.map((row) => (
          <MasterAppointmentCard key={row.id} row={row} onClick={() => setSelected(row)} />
        ))}
      </div>

      {selected && <MasterAppointmentDetail row={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}
