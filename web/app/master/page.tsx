"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterAppointmentCard } from "./_components/MasterAppointmentCard";
import { MasterAppointmentDetail } from "./_components/MasterAppointmentDetail";
import { WeekDayStrip } from "./_components/WeekDayStrip";
import type { MasterAppointment } from "./_components/types";
import { formatKyivDayLabel, kyivTodayYmd, shiftKyivDay } from "./_lib/kyiv-day";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        platform?: string;
        version?: string;
        ready?: () => void;
        expand?: () => void;
      };
    };
  }
}

type InitDataDebug = {
  hadTelegramObject: boolean;
  hadWebAppObject: boolean;
  initDataRaw: string;
  initDataLength: number;
  locationHash: string;
  platform: string;
  version: string;
  userAgent: string;
  waitedMs: number;
};

function captureDebug(start: number): InitDataDebug {
  const webApp = window.Telegram?.WebApp;
  return {
    hadTelegramObject: Boolean(window.Telegram),
    hadWebAppObject: Boolean(webApp),
    initDataRaw: webApp?.initData ?? "",
    initDataLength: (webApp?.initData ?? "").length,
    locationHash: window.location.hash || "",
    platform: webApp?.platform ?? "",
    version: webApp?.version ?? "",
    userAgent: navigator.userAgent,
    waitedMs: Date.now() - start,
  };
}

/** Чекає появу Telegram WebApp SDK (скрипт у layout.tsx) до WAIT_MS, інакше вважаємо, що відкрито поза Telegram. */
function waitForTelegramInitData(
  timeoutMs = 4000,
): Promise<{ initData: string | null; debug: InitDataDebug }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const initData = window.Telegram?.WebApp?.initData;
      if (initData) {
        window.Telegram?.WebApp?.ready?.();
        window.Telegram?.WebApp?.expand?.();
        resolve({ initData, debug: captureDebug(start) });
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve({ initData: null, debug: captureDebug(start) });
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
  const [debug, setDebug] = useState<InitDataDebug | null>(null);
  const [day, setDay] = useState(() => kyivTodayYmd());
  const [masterName, setMasterName] = useState<string | null>(null);
  const [multiView, setMultiView] = useState(false);
  const [appointments, setAppointments] = useState<MasterAppointment[]>([]);
  const [weekCounts, setWeekCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MasterAppointment | null>(null);

  useEffect(() => {
    void waitForTelegramInitData().then(({ initData: data, debug: dbg }) => {
      setInitData(data);
      setDebug(dbg);
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
    void fetch(`/api/master/appointments?day=${encodeURIComponent(day)}&week=1`, {
      headers: { "x-telegram-init-data": initData },
      cache: "no-store",
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося завантажити журнал");
        if (cancelled) return;
        setMasterName(json.masterName || null);
        setMultiView(Boolean(json.multiView));
        setAppointments(json.appointments || []);
        const counts: Record<string, number> = {};
        for (const row of json.weekDays || []) counts[row.day] = row.count;
        setWeekCounts(counts);
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
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-gray-600">
          Відкрийте журнал через кнопку «Мій журнал» у Telegram-боті, а не напряму в браузері.
        </p>
        {debug && (
          <pre className="max-w-full overflow-x-auto rounded-lg bg-gray-100 p-2 text-left text-[10px] text-gray-500">
            {JSON.stringify(debug, null, 2)}
          </pre>
        )}
      </main>
    );
  }

  return (
    <main className="min-h-screen px-3 pb-6 pt-4">
      <header className="mb-3">
        <WeekDayStrip
          anchorDay={day}
          selectedDay={day}
          dayCounts={weekCounts}
          onSelectDay={(d) => setDay(d)}
          onShiftWeek={(delta) => setDay((d) => shiftKyivDay(d, delta))}
        />
        <div className="mt-2 text-center">
          <div className="text-sm font-semibold text-gray-900">{isToday ? "Сьогодні" : dayLabel}</div>
          {masterName && (
            <div className="text-[11px] text-gray-500">
              {masterName}
              {multiView && " · розширений журнал"}
            </div>
          )}
        </div>
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
