// Колонка «Консультація» винесена з DirectClientTableRow (легше підтримувати + memo за пропсами)
"use client";

import { memo, type CSSProperties } from "react";
import type { DirectClient } from "@/lib/direct-types";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import { ConfirmedCheckIcon } from "./CheckIcon";
import { WithCornerRedDot } from "./DirectClientTableAvatar";
import {
  formatDateShortYear,
  formatDateDDMMYY,
  formatDateDDMMYYHHMM,
} from "./direct-client-table-formatters";
import { effectiveAltegioAttendanceDisplay } from "./direct-attendance-display";

export type DirectClientTableRowConsultationCellProps = {
  client: DirectClient;
  winningKey: string | null;
  todayKyivDayForDots: string;
  activityKeys: readonly string[];
  cellStyle: CSSProperties;
  onOpenConsultationHistory: (c: DirectClient) => void;
};

function hasActivity(keys: readonly string[], k: string): boolean {
  return keys.includes(k);
}

function consultationCellPropsEqual(
  a: DirectClientTableRowConsultationCellProps,
  b: DirectClientTableRowConsultationCellProps
): boolean {
  if (a.client !== b.client) return false;
  if (a.winningKey !== b.winningKey) return false;
  if (a.todayKyivDayForDots !== b.todayKyivDayForDots) return false;
  if (a.onOpenConsultationHistory !== b.onOpenConsultationHistory) return false;
  const pa = a.activityKeys;
  const na = b.activityKeys;
  if (pa !== na) {
    if (pa.length !== na.length) return false;
    for (let i = 0; i < pa.length; i++) {
      if (pa[i] !== na[i]) return false;
    }
  }
  const ps = a.cellStyle;
  const ns = b.cellStyle;
  if (ps === ns) return true;
  return (
    ps.width === ns.width &&
    ps.minWidth === ns.minWidth &&
    ps.maxWidth === ns.maxWidth &&
    ps.boxSizing === ns.boxSizing &&
    ps.boxShadow === ns.boxShadow
  );
}

function DirectClientTableRowConsultationCellInner({
  client,
  winningKey,
  todayKyivDayForDots,
  activityKeys,
  cellStyle,
  onOpenConsultationHistory,
}: DirectClientTableRowConsultationCellProps) {
  const kyivDayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayKyivDay = kyivDayFmt.format(new Date());

  const consultIsToday = client.consultationBookingDate
    ? (() => {
        try {
          const dateValue =
            typeof client.consultationBookingDate === "string"
              ? client.consultationBookingDate.trim()
              : client.consultationBookingDate;
          const dateStr = typeof dateValue === "string" ? dateValue : String(dateValue);
          const isoDateMatch = dateStr.match(
            /\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[\+\-]\d{2}:\d{2})?)?/
          );
          if (!isoDateMatch) {
            const parts = dateStr.split(/\s+/);
            for (const part of parts) {
              const testDate = new Date(part);
              if (!isNaN(testDate.getTime()) && part.match(/^\d/)) {
                return kyivDayFmt.format(testDate) === todayKyivDay;
              }
            }
            return false;
          }
          const appointmentDate = new Date(isoDateMatch[0]);
          if (isNaN(appointmentDate.getTime())) {
            return false;
          }
          return kyivDayFmt.format(appointmentDate) === todayKyivDay;
        } catch {
          return false;
        }
      })()
      : false;

  return (
    <td
      className="pl-0 pr-1 sm:pr-1.5 py-1 text-xs whitespace-nowrap text-left"
      style={cellStyle}
    >
      {client.consultationBookingDate ? (
        (() => {
          try {
            const dateValue =
              typeof client.consultationBookingDate === "string"
                ? client.consultationBookingDate.trim()
                : client.consultationBookingDate;

            let dateStr = typeof dateValue === "string" ? dateValue : String(dateValue);

            const isoDateMatch = dateStr.match(
              /\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[\+\-]\d{2}:\d{2})?)?/
            );
            if (!isoDateMatch) {
              const parts = dateStr.split(/\s+/);
              for (const part of parts) {
                const testDate = new Date(part);
                if (!isNaN(testDate.getTime()) && part.match(/^\d/)) {
                  dateStr = part;
                  break;
                }
              }
            } else {
              dateStr = isoDateMatch[0];
            }

            const appointmentDate = new Date(dateStr);
            if (isNaN(appointmentDate.getTime())) {
              console.warn(
                "[DirectClientTable] Invalid consultationBookingDate:",
                client.consultationBookingDate
              );
              return "";
            }

            const kyivDayFmtInner = new Intl.DateTimeFormat("en-CA", {
              timeZone: "Europe/Kyiv",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            });
            const todayKyivDayInner = kyivDayFmtInner.format(new Date());
            const consultKyivDay = kyivDayFmtInner.format(appointmentDate);
            const isPast = consultKyivDay < todayKyivDayInner;
            const isToday = consultKyivDay === todayKyivDayInner;
            const isPastOrToday = consultKyivDay <= todayKyivDayInner;
            void isPastOrToday;
            const formattedDateStr = formatDateShortYear(dateStr);
            const isOnline = client.isOnlineConsultation || false;

            const createdAtDate = client.consultationRecordCreatedAt
              ? new Date(client.consultationRecordCreatedAt)
              : null;
            const createdAtStr =
              createdAtDate && !isNaN(createdAtDate.getTime())
                ? createdAtDate.toLocaleDateString("uk-UA", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : null;
            void createdAtStr;
            const consultCreatedToday =
              createdAtDate && !isNaN(createdAtDate.getTime())
                ? kyivDayFmtInner.format(createdAtDate) === todayKyivDayInner
                : false;

            const isDebugClient =
              client.instagramUsername === "kobra_best" ||
              client.instagramUsername === "olena_toporina" ||
              (client.firstName === "Юлія" && client.lastName === "Кобра") ||
              (client.firstName === "Топоріна" && client.lastName === "Олена");

            if (isDebugClient) {
              console.log(
                `[DirectClientTable] 🔍 Діагностика для ${client.instagramUsername || "unknown"}:`,
                {
                  clientId: client.id,
                  instagramUsername: client.instagramUsername,
                  firstName: client.firstName,
                  lastName: client.lastName,
                  consultationBookingDate: client.consultationBookingDate,
                  consultationBookingDateType: typeof client.consultationBookingDate,
                  isOnlineConsultation: client.isOnlineConsultation,
                  isOnlineConsultationType: typeof client.isOnlineConsultation,
                  isOnline,
                  dateStr: formattedDateStr,
                  extractedDateStr: dateStr,
                  dateValue,
                  paidServiceDate: client.paidServiceDate,
                  signedUpForPaidService: client.signedUpForPaidService,
                  fullClient: client,
                }
              );
            }

            const consultStatusDateEst = formatDateDDMMYYHHMM(
              client.consultationAttendanceSetAt ?? client.consultationRecordCreatedAt
            );
            const attIconCls = "text-[14px] leading-none";
            const consultAttendanceEffective = effectiveAltegioAttendanceDisplay(
              (client as any).consultationAttendanceValue,
              client.consultationAttended,
              consultKyivDay,
              todayKyivDayInner
            );
            const showConsultCheck =
              consultAttendanceEffective === 2 ? true : isPast || isToday;
            let attendanceIcon = null;
            if (client.consultationCancelled) {
              attendanceIcon = (
                <span
                  className={`text-orange-600 ${attIconCls}`}
                  title={
                    consultStatusDateEst !== "-"
                      ? `Скасовано до дати консультації. Дата встановлення статусу: ${consultStatusDateEst}`
                      : "Скасовано до дати консультації"
                  }
                >
                  🚫
                </span>
              );
            } else if (client.consultationAttended === true && showConsultCheck) {
              const isConfirmed = consultAttendanceEffective === 2;
              attendanceIcon = (
                <span
                  className={`inline-flex items-center justify-center ${attIconCls}`}
                  title={
                    consultStatusDateEst !== "-"
                      ? `${isConfirmed ? "Клієнтка підтвердила запис на консультацію" : "Клієнтка прийшла на консультацію"}. Дата встановлення статусу: ${consultStatusDateEst}`
                      : isConfirmed
                        ? "Клієнтка підтвердила запис на консультацію"
                        : "Клієнтка прийшла на консультацію"
                  }
                >
                  {isConfirmed ? (
                    <ConfirmedCheckIcon size={17} />
                  ) : (
                    <span className="text-[14px] leading-none">✅</span>
                  )}
                </span>
              );
            } else if (
              (client.consultationAttended === false || client.state === "consultation-no-show") &&
              (isPast || isToday)
            ) {
              attendanceIcon = (
                <span
                  className={`text-red-600 ${attIconCls}`}
                  title={
                    consultStatusDateEst !== "-"
                      ? `Клієнтка не з'явилася на консультацію. Дата встановлення статусу: ${consultStatusDateEst}`
                      : "Клієнтка не з'явилася на консультацію"
                  }
                >
                  ❌
                </span>
              );
            } else if (isPast) {
              attendanceIcon = (
                <span
                  className={`text-gray-500 ${attIconCls}`}
                  title={
                    consultStatusDateEst !== "-"
                      ? `Немає підтвердження відвідування консультації. Дата встановлення статусу: ${consultStatusDateEst}`
                      : "Немає підтвердження відвідування консультації (встановіть attendance в Altegio)"
                  }
                >
                  ❓
                </span>
              );
            } else {
              attendanceIcon = (
                <span
                  className={`text-gray-700 ${attIconCls}`}
                  title={
                    consultStatusDateEst !== "-"
                      ? `Присутність: Очікується. Дата встановлення статусу: ${consultStatusDateEst}`
                      : "Присутність: Очікується"
                  }
                >
                  ⏳
                </span>
              );
            }

            const baseTitle = isPast
              ? isOnline
                ? "Минулий запис на онлайн-консультацію"
                : "Минулий запис на консультацію"
              : isOnline
                ? "Майбутній запис на онлайн-консультацію"
                : "Майбутній запис на консультацію";
            const dateEstablished = formatDateDDMMYYHHMM(client.consultationRecordCreatedAt);
            const dateEstablishedDisplay = formatDateDDMMYY(client.consultationRecordCreatedAt);
            const consultantFull = (client.consultationMasterName || "").toString().trim();
            let tooltipTitle =
              dateEstablished !== "-"
                ? `${baseTitle}\nЗапис створено: ${dateEstablished}`
                : baseTitle;
            if (consultantFull) {
              tooltipTitle += `\nМайстер: ${consultantFull}`;
            }

            const consultAttendanceDotTitle = "Тригер: змінилась присутність консультації";
            const consultDateDotTitle = "Тригер: змінилась дата консультації";
            const isConsultStatusSetToday = Boolean(
              client.consultationAttendanceSetAt &&
                kyivDayFromISO(String(client.consultationAttendanceSetAt)) === todayKyivDayForDots
            );
            const hasConsultAttendanceChange =
              hasActivity(activityKeys, "consultationAttended") ||
              hasActivity(activityKeys, "consultationCancelled") ||
              ((winningKey === "consultationBookingDate" ||
                winningKey === "consultationRecordCreatedAt") &&
                consultAttendanceEffective === 2 &&
                isConsultStatusSetToday);
            const showDotOnConsultDate = false;
            const consultationWinningKeys = [
              "consultationAttended",
              "consultationCancelled",
              "consultationBookingDate",
              "consultationRecordCreatedAt",
            ];
            const showConsultAttendanceDotEffective = Boolean(
              winningKey === "consultationAttended" ||
                winningKey === "consultationCancelled" ||
                winningKey === "consultationBookingDate" ||
                winningKey === "consultationRecordCreatedAt" ||
                (hasConsultAttendanceChange &&
                  consultationWinningKeys.includes(winningKey ?? ""))
            );
            const hasPaidRecord = Boolean(client.signedUpForPaidService && client.paidServiceDate);
            const compactConsultView = isPast && client.consultationAttended === true && hasPaidRecord;

            if (compactConsultView) {
              const compactTooltip = `Клієнтка прийшла на консультацію. Букінг: ${formattedDateStr}. Запис створено: ${dateEstablished}`;
              return (
                <button
                  type="button"
                  className="p-0 w-full inline-flex items-center justify-center hover:opacity-80 transition-opacity disabled:opacity-50"
                  title={`${compactTooltip}\nНатисніть, щоб переглянути історію консультацій`}
                  onClick={() => {
                    if (!client.altegioClientId) return;
                    onOpenConsultationHistory(client);
                  }}
                  disabled={!client.altegioClientId}
                >
                  <span className="sr-only">Дата консультації: {formattedDateStr}</span>
                  <span className="text-[14px] leading-none text-green-600">✅</span>
                </button>
              );
            }

            return (
              <span className="flex flex-col items-start gap-0.5">
                <span className="flex items-center gap-[1ch]">
                  <button
                    className={
                      "p-0 " +
                      (isToday
                        ? "text-green-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50"
                        : isPast
                          ? "text-amber-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50"
                          : "text-blue-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50")
                    }
                    title={`${tooltipTitle}\nНатисніть, щоб переглянути історію консультацій`}
                    onClick={() => {
                      if (!client.altegioClientId) return;
                      onOpenConsultationHistory(client);
                    }}
                    disabled={!client.altegioClientId}
                  >
                    <span className="inline-flex items-center">
                      <WithCornerRedDot
                        show={showDotOnConsultDate}
                        title={consultDateDotTitle}
                        dotClassName="-top-[5px] -right-[4px]"
                      >
                        <span
                          className={`rounded-full px-0 py-0.5 ${
                            consultIsToday ? "bg-green-200" : consultCreatedToday ? "bg-gray-200" : ""
                          }`}
                        >
                          {formattedDateStr}
                          {isOnline ? "💻" : "📅"}
                        </span>
                      </WithCornerRedDot>
                    </span>
                  </button>
                  {typeof client.consultationAttemptNumber === "number" &&
                  client.consultationAttemptNumber >= 2 ? (
                    <span
                      className="inline-flex items-center justify-center rounded-full bg-white border border-blue-300 text-blue-600 font-bold text-[12px] w-[20px] h-[20px]"
                      title={`Повторна спроба консультації №${client.consultationAttemptNumber}`}
                    >
                      {client.consultationAttemptNumber}
                    </span>
                  ) : null}
                  {attendanceIcon ? (
                    <WithCornerRedDot
                      show={showConsultAttendanceDotEffective}
                      title={consultAttendanceDotTitle}
                      dotClassName="-top-[5px] -right-[4px]"
                    >
                      {attendanceIcon}
                    </WithCornerRedDot>
                  ) : null}
                </span>

                {dateEstablishedDisplay !== "-" ? (
                  <span
                    className="text-[10px] leading-none opacity-60 max-w-[220px] sm:max-w-[320px] truncate text-left"
                    title={`Запис створено: ${dateEstablished}${consultantFull ? `\nМайстер: ${consultantFull}` : ""}`}
                  >
                    {dateEstablishedDisplay}
                  </span>
                ) : null}
              </span>
            );
          } catch (err) {
            console.error(
              "[DirectClientTable] Error formatting consultationBookingDate:",
              err,
              client.consultationBookingDate
            );
            return "";
          }
        })()
      ) : (client as any).consultationDeletedInAltegio ? (
        <span
          className="text-gray-500 italic"
          title="Візит/запис видалено в Altegio (404), консультацію очищено"
        >
          Видалено в Altegio
        </span>
      ) : (
        ""
      )}
    </td>
  );
}

export const DirectClientTableRowConsultationCell = memo(
  DirectClientTableRowConsultationCellInner,
  consultationCellPropsEqual
);
