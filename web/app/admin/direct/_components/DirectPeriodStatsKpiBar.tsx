// web/app/admin/direct/_components/DirectPeriodStatsKpiBar.tsx
// Три колонки KPI (з початку місяця / сьогодні / майбутнє) — раніше були у фіксованому футері таблиці Direct.

"use client";

import { StateIcon } from "./StateIcon";
import { BrokenHeartIcon } from "./BrokenHeartIcon";
import { YellowDotHalfRightIcon } from "./YellowDotHalfRightIcon";
import { YellowDotIcon } from "./YellowDotIcon";

/** Блоки past/today/future з GET ?statsOnly (periodStats) */
export type DirectPeriodStatsKpiPayload = {
  past: Record<string, number | null | undefined>;
  today: Record<string, number | null | undefined>;
  future: Record<string, number | null | undefined>;
};

type TodayRow = Record<string, number | null | undefined> & {
  consultationCreated?: number;
};

export function DirectPeriodStatsKpiBar({
  stats,
  loading,
  emptyOrErrorText,
}: {
  stats: DirectPeriodStatsKpiPayload | null;
  loading?: boolean;
  emptyOrErrorText?: string | null;
}) {
  const iconSize = 14;
  const BlueCircle2Icon = ({ size = iconSize }: { size?: number }) => (
    <svg
      className="shrink-0"
      style={{ width: `${size}px`, height: `${size}px` }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="12" cy="12" r="11" fill="#EFF6FF" stroke="#93C5FD" strokeWidth="1.5" />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#2563EB"
        fontWeight="bold"
        fontSize="12"
        fontFamily="system-ui"
      >
        2
      </text>
    </svg>
  );

  const formatThousandVal = (v: number) => String(Math.round((v ?? 0) / 1000));

  if (loading) {
    return (
      <section className="mt-10 mb-6 w-full max-w-full" aria-label="KPI по періодах">
        <h2 className="text-lg font-semibold mb-2 text-base-content">KPI по періодах</h2>
        <div className="bg-base-200 rounded-lg border border-base-300 min-h-[48px] py-3 px-3 text-sm text-base-content/60">
          Завантаження KPI…
        </div>
      </section>
    );
  }

  if (!stats) {
    return (
      <section className="mt-10 mb-6 w-full max-w-full" aria-label="KPI по періодах">
        <h2 className="text-lg font-semibold mb-2 text-base-content">KPI по періодах</h2>
        <div className="bg-base-200 rounded-lg border border-base-300 min-h-[40px] py-2 px-3 text-xs text-base-content/70">
          {emptyOrErrorText || "Дані KPI недоступні"}
        </div>
      </section>
    );
  }

  const todayData = stats.today as TodayRow;
  const hasTodayKpi = typeof todayData.consultationCreated === "number";

  const renderPastBlock = () => {
    const pastData = stats.past;
    return (
      <div
        className="px-2 relative grid gap-0 min-h-[2rem] min-w-0"
        style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gridTemplateRows: "auto auto" }}
      >
        <div className="flex flex-nowrap items-center gap-x-1 gap-y-0 min-h-[1rem] min-w-0 overflow-x-auto">
          <span className="font-medium text-gray-600 shrink-0">Консультації:</span>
          <span title="Консультацій створено" className="inline-flex items-center gap-1">
            <StateIcon state="consultation-booked" size={iconSize} />
            <span>{pastData.consultationCreated ?? 0}</span>
          </span>
          <span title="Онлайн консультації: 💻 — шт." className="shrink-0">
            💻 {pastData.consultationOnlineCount ?? 0}
          </span>
          <span title="Консультації (офлайн): 📅">
            📅 {Math.max(0, (pastData.consultationCreated ?? 0) - (pastData.consultationOnlineCount ?? 0))}
          </span>
          <span title="Заброньовані (відбулись): ⏳">⏳ {pastData.consultationBookedPast ?? 0}</span>
          <span title="Заброньовані онлайн">💻 {pastData.consultationBookedPastOnlineCount ?? 0}</span>
          <span title="Заброньовані офлайн">
            📅 {Math.max(0, (pastData.consultationBookedPast ?? 0) - (pastData.consultationBookedPastOnlineCount ?? 0))}
          </span>
          <span className="text-green-600" title="Реалізовані: ✅">
            ✅ {pastData.consultationRealized ?? 0}
          </span>
          <span className="text-red-600" title="Не прийшли: ❌">
            ❌ {pastData.consultationNoShow ?? 0}
          </span>
          <span className="text-orange-600" title="Скасовані: 🚫">
            🚫 {pastData.consultationCancelled ?? 0}
          </span>
          <span title="Немає продажі" className="inline-flex items-center gap-0.5">
            <BrokenHeartIcon size={iconSize} />
            <span>{pastData.noSaleCount ?? 0}</span>
          </span>
          <span title="Відновлена консультація" className="inline-flex items-center gap-1">
            <BlueCircle2Icon size={iconSize} />
            <span>{pastData.consultationRescheduledCount ?? 0}</span>
          </span>
        </div>
        <div className="flex items-center justify-end gap-x-1 min-h-[1rem] shrink-0 pl-1">
          <span
            className="font-bold text-gray-700 shrink-0"
            title={`Оборот: ${formatThousandVal(pastData.turnoverToday ?? 0)} тис. грн`}
          >
            <span className="opacity-90">💰</span> Фін. Рез. <span>{formatThousandVal(pastData.turnoverToday ?? 0)}</span>
          </span>
        </div>
        <div className="flex flex-nowrap items-center gap-x-1 gap-y-0 min-h-[1rem] min-w-0 overflow-x-auto">
          <span className="font-medium text-gray-600 shrink-0">Записи:</span>
          <span title="Записів заплановано (майбутні)" className="inline-flex items-center gap-1 shrink-0">
            <YellowDotIcon size={iconSize} />
            <span>{formatThousandVal(pastData.plannedPaidSum ?? 0)}</span>
          </span>
          <span title="Нові клієнти" className="inline-flex items-center gap-1 shrink-0">
            <YellowDotIcon size={iconSize} />
            <span>{pastData.newClientsCount ?? 0}</span>
          </span>
          <span title="Записів створено" className="inline-flex items-center gap-1">
            📋 {formatThousandVal(pastData.recordsCreatedSum ?? 0)}
          </span>
          <span title="Записів заплановано" className="inline-flex items-center gap-1">
            ⏳ {formatThousandVal(pastData.plannedPaidSum ?? 0)}
          </span>
          <span className="text-green-600" title="Реалізовано">
            ✅ {formatThousandVal(pastData.recordsRealizedSum ?? 0)}
          </span>
          <span title="Перезаписів">🔁 {pastData.rebookingsCount ?? 0}</span>
          <span title="Допродажі" className="inline-flex items-center gap-1">
            <img
              src="/assets/footer-nail-polish.png"
              alt=""
              className="inline-block w-3.5 h-3.5 object-contain align-middle [mix-blend-mode:multiply]"
            />
            <span>{formatThousandVal(pastData.upsalesGoodsSum ?? 0)}</span>
          </span>
          <span title="Немає перезапису">⚠️ {pastData.noRebookCount ?? 0}</span>
          <span title="Повернуті клієнти" className="inline-flex items-center gap-1">
            <BlueCircle2Icon size={iconSize} />
            <span>{pastData.returnedClientsCount ?? 0}</span>
          </span>
          <span className="text-orange-600" title="Записи скасовані">
            🚫 {pastData.recordsCancelledCount ?? 0}
          </span>
          <span className="text-red-600" title="Записи: не прийшов">
            ❌ {pastData.recordsNoShowCount ?? 0}
          </span>
        </div>
        <div className="flex items-center gap-x-1 min-h-[1rem] shrink-0 pl-1">
          <span className="font-medium text-gray-600">Ліди:</span>
          <span title="Нові ліди" className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-[#3b82f6] shrink-0" />
            <span>{pastData.newLeadsCount ?? 0}</span>
          </span>
          <span className="font-medium text-gray-600">Клієнти:</span>
          <span title="Нові клієнти" className="inline-flex items-center gap-1">
            <YellowDotIcon size={iconSize} />
            <span>{pastData.newClientsCount ?? 0}</span>
          </span>
          <span title="Повернуті клієнти" className="inline-flex items-center gap-1">
            <BlueCircle2Icon size={iconSize} />
            <span>{pastData.returnedClientsCount ?? 0}</span>
          </span>
        </div>
      </div>
    );
  };

  const renderTodayBlock = () => (
    <div className="px-2 relative min-w-0">
      {hasTodayKpi ? (
        <div
          className="grid gap-0 min-h-[2rem] min-w-0"
          style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gridTemplateRows: "auto auto" }}
        >
          <div className="flex flex-nowrap items-center gap-x-1 gap-y-0 min-h-[1rem] min-w-0 overflow-x-auto">
            <span className="font-medium text-gray-600 shrink-0">Консультації:</span>
            <span title="Консультацій створено" className="inline-flex items-center gap-1">
              <StateIcon state="consultation-booked" size={iconSize} />
              <span>{todayData.consultationCreated ?? 0}</span>
            </span>
            <span title="Онлайн консультації">💻 {todayData.consultationOnlineCount ?? 0}</span>
            <span title="Консультації (офлайн)">
              📅 {(todayData.consultationCreated ?? 0) - (todayData.consultationOnlineCount ?? 0)}
            </span>
            <span title="Заброньовані (на сьогодні)">⏳ {todayData.consultationBookedToday ?? 0}</span>
            <span title="Заброньовані онлайн">💻 {todayData.consultationBookedTodayOnlineCount ?? 0}</span>
            <span title="Заброньовані офлайн">
              📅{" "}
              {Math.max(0, (todayData.consultationBookedToday ?? 0) - (todayData.consultationBookedTodayOnlineCount ?? 0))}
            </span>
            <span className="text-green-600" title="Реалізовані">
              ✅ {todayData.consultationRealized ?? 0}
            </span>
            <span className="text-red-600" title="Не прийшли">
              ❌ {todayData.consultationNoShow ?? 0}
            </span>
            <span className="text-orange-600" title="Скасовані">
              🚫 {todayData.consultationCancelled ?? 0}
            </span>
            <span title="Немає продажі" className="inline-flex items-center gap-0.5">
              <BrokenHeartIcon size={iconSize} />
              <span>{todayData.noSaleCount ?? 0}</span>
            </span>
            <span title="Відновлена консультація" className="inline-flex items-center gap-1">
              <BlueCircle2Icon size={iconSize} />
              <span>{todayData.consultationRescheduledCount ?? 0}</span>
            </span>
          </div>
          <div className="flex items-center justify-end gap-x-1 min-h-[1rem] shrink-0 pl-1">
            <span
              className="font-bold text-gray-700 shrink-0"
              title={`Оборот: ${formatThousandVal(todayData.turnoverToday ?? 0)} тис. грн`}
            >
              <span className="opacity-90">💰</span> Фін. Рез. <span>{formatThousandVal(todayData.turnoverToday ?? 0)}</span>
            </span>
          </div>
          <div className="flex flex-nowrap items-center gap-x-1 gap-y-0 min-h-[1rem] min-w-0 overflow-x-auto">
            <span className="font-medium text-gray-600 shrink-0">Записи:</span>
            <span title="Записів заплановано (майбутні)" className="inline-flex items-center gap-1 shrink-0">
              <YellowDotIcon size={iconSize} />
              <span>{formatThousandVal(todayData.plannedPaidSum ?? 0)}</span>
            </span>
            <span title="Нові клієнти" className="inline-flex items-center gap-1 shrink-0">
              <YellowDotIcon size={iconSize} />
              <span>{todayData.newClientsCount ?? 0}</span>
            </span>
            <span title="Записів створено" className="inline-flex items-center gap-1">
              📋 {formatThousandVal(todayData.recordsCreatedSum ?? 0)}
            </span>
            <span title="Записів заплановано" className="inline-flex items-center gap-1">
              ⏳ {formatThousandVal(todayData.plannedPaidSum ?? 0)}
            </span>
            <span className="text-green-600" title="Реалізовано">
              ✅ {formatThousandVal(todayData.recordsRealizedSum ?? 0)}
            </span>
            <span title="Перезаписів">🔁 {todayData.rebookingsCount ?? 0}</span>
            <span title="Допродажі" className="inline-flex items-center gap-1">
              <img
                src="/assets/footer-nail-polish.png"
                alt=""
                className="inline-block w-3.5 h-3.5 object-contain align-middle [mix-blend-mode:multiply]"
              />
              <span>{formatThousandVal(todayData.upsalesGoodsSum ?? 0)}</span>
            </span>
            <span title="Немає перезапису">⚠️ {todayData.noRebookCount ?? 0}</span>
            <span title="Повернуті клієнти" className="inline-flex items-center gap-1">
              <BlueCircle2Icon size={iconSize} />
              <span>{todayData.returnedClientsCount == null ? "—" : todayData.returnedClientsCount}</span>
            </span>
            <span className="text-orange-600" title="Записи скасовані">
              🚫 {todayData.recordsCancelledCount ?? 0}
            </span>
            <span className="text-red-600" title="Записи: не прийшов">
              ❌ {todayData.recordsNoShowCount ?? 0}
            </span>
          </div>
          <div className="flex items-center gap-x-1 min-h-[1rem] shrink-0 pl-1">
            <span className="font-medium text-gray-600">Ліди:</span>
            <span title="Нові ліди (створено сьогодні)" className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-[#3b82f6] shrink-0" />
              <span>{todayData.newLeadsCount ?? 0}</span>
            </span>
            <span className="font-medium text-gray-600">Клієнти:</span>
            <span title="Нові клієнти" className="inline-flex items-center gap-1">
              <YellowDotIcon size={iconSize} />
              <span>{todayData.newClientsCount ?? 0}</span>
            </span>
            <span title="Повернуті клієнти" className="inline-flex items-center gap-1">
              <BlueCircle2Icon size={iconSize} />
              <span>{todayData.returnedClientsCount == null ? "—" : todayData.returnedClientsCount}</span>
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end min-h-[2rem]" />
      )}
    </div>
  );

  const renderFutureBlock = () => {
    const futureData = stats.future;
    return (
      <div className="px-3 relative flex flex-col gap-0">
        <div className="flex flex-nowrap overflow-x-auto items-center gap-x-2 gap-y-0 min-h-[1rem]">
          <span className="font-medium text-gray-600 shrink-0">Консультацій:</span>
          <span title="Призначено (майбутні)" className="shrink-0">
            ⏳ {futureData.consultationPlannedFuture ?? 0}
          </span>
          <span title="Майбутні онлайн">💻 {futureData.consultationPlannedOnlineCount ?? 0}</span>
          <span title="Майбутні офлайн">
            📅 {Math.max(0, (futureData.consultationPlannedFuture ?? 0) - (futureData.consultationPlannedOnlineCount ?? 0))}
          </span>
        </div>
        <div className="flex flex-nowrap overflow-x-auto items-center gap-x-2 gap-y-0 min-h-[1rem]">
          <span className="font-medium text-gray-600 shrink-0">Записів:</span>
          <span title="Записів майбутніх" className="inline-flex items-center gap-1 shrink-0">
            <YellowDotIcon size={iconSize} />
            <span>{formatThousandVal(futureData.plannedPaidSumToMonthEnd ?? 0)}</span>
          </span>
          <span title="До кінця місяця" className="inline-flex items-center gap-1 shrink-0">
            <YellowDotHalfRightIcon size={iconSize} />
            <span>{formatThousandVal(futureData.plannedPaidSumToMonthEnd ?? 0)}</span>
          </span>
          <span title="Наступного місяця" className="inline-flex items-center gap-1 shrink-0">
            ➡️ {formatThousandVal(futureData.plannedPaidSumNextMonth ?? 0)}
          </span>
          <span title="+2 міс." className="inline-flex items-center gap-1 shrink-0">
            ⏭️ {formatThousandVal(futureData.plannedPaidSumPlus2Months ?? 0)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <section className="mt-10 mb-6 w-full max-w-full" aria-label="KPI по періодах">
      <h2 className="text-lg font-semibold mb-2 text-base-content">KPI по періодах</h2>
      <p className="text-xs text-base-content/60 mb-2">
        З початку місяця (Kyiv) · обрана дата «Звіт за:» · майбутнє. Раніше відображалось у футері таблиці Direct.
      </p>
      <div className="bg-gray-200 rounded-lg border border-gray-300 min-h-[40px] py-2 px-1 overflow-x-auto">
        <div className="grid divide-x divide-gray-300 text-xs min-w-0" style={{ gridTemplateColumns: "8fr 6fr 3fr" }}>
          {renderPastBlock()}
          {renderTodayBlock()}
          {renderFutureBlock()}
        </div>
      </div>
    </section>
  );
}
