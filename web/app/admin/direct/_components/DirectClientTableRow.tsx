// Рядок таблиці клієнтів Direct (винесено з DirectClientTable)
"use client";

import { memo, type CSSProperties, type ReactNode } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { DirectClient } from "@/lib/direct-types";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import { clientShowsF4SoldFireNow } from "@/lib/direct-f4-client-match";
import { firstToken } from "./masterFilterUtils";
import { getChatBadgeStyle } from "./ChatBadgeIcon";
import { CommunicationChannelPicker } from "./CommunicationChannelPicker";
import { ConfirmedCheckIcon } from "./CheckIcon";
import { StateIcon } from "./StateIcon";
import { DirectStatusCell } from "./DirectStatusCell";
import { BinotelCallTypeIcon } from "./BinotelCallTypeIcon";
import { PlayRecordingButton } from "./PlayRecordingButton";
import { AvatarSlot, CornerRedDot, WithCornerRedDot } from "./DirectClientTableAvatar";
import {
  formatDate,
  formatDateShortYear,
  formatUAHExact,
  formatUAHThousands,
  shortPersonName,
  getFullName,
  formatDateDDMMYY,
  formatDateDDMMYYHHMM,
} from "./direct-client-table-formatters";
import {
  buildAltegioClientsSearchUrl,
  formatActivityDate,
  getTriggerDescription,
} from "./direct-client-table-activity";
import {
  SpendMegaBadge,
  SpendStarBadge,
  SpendCircleBadge,
  ClientBadgeIcon,
  LeadBadgeIcon,
  BinotelLeadBadgeIcon,
} from "./DirectClientTableRowBadges";
import { useDirectClientTableRowContext } from "./direct-client-table-row-context";
import type { DirectTableColumnKey } from "./direct-client-table-column-layout";

export type DirectClientTableRowProps = {
  client: DirectClient;
  index: number;
  virtualRow: VirtualItem | null;
  measureElement?: (element: Element | null) => void;
};

function DirectClientTableRowInner({
  client,
  index,
  virtualRow,
  measureElement,
}: DirectClientTableRowProps) {
  const {
    columnWidths,
    getStickyLeft,
    getColumnStyle,
    getStickyColumnStyle,
    debugActivity,
    sortBy,
    sortOrder,
    todayBlockRowIndices,
    statuses,
    masters,
    onClientUpdate,
    onStatusMenuOpen,
    hideFinances,
    hideActionsColumn,
    hideSalesColumn,
    canListenCalls,
    chatStatusUiVariant,
    instCallsCellMinHeight,
    setFullscreenAvatar,
    setMessagesHistoryClient,
    setBinotelHistoryClient,
    setInlineRecordingUrl,
    setStateHistoryClient,
    setRecordHistoryClient,
    setRecordHistoryType,
    setMasterHistoryClient,
    setEditingClient,
    bodyTableTotalWidthPx,
    enforceExplicitCellWidthsPx,
    getEffectiveColumnWidthPx,
  } = useDirectClientTableRowContext();

  /** При tbody display:block (віртуалізація) colgroup не стабільно задає ширини — дублюємо з effectiveWidths */
  const cellPx = (key: DirectTableColumnKey, base: CSSProperties): CSSProperties => {
    if (!enforceExplicitCellWidthsPx) return base;
    const w = getEffectiveColumnWidthPx(key);
    return {
      ...base,
      width: `${w}px`,
      minWidth: `${w}px`,
      maxWidth: `${w}px`,
      boxSizing: "border-box",
    };
  };

const activityKeys = client.lastActivityKeys ?? [];
const hasActivity = (k: string) => activityKeys.includes(k);
const hasPrefix = (p: string) => activityKeys.some((k) => k.startsWith(p));
const isActiveMode = sortBy === 'updatedAt' && sortOrder === 'desc';
const todayKyivDayForDots = kyivDayFromISO(new Date().toISOString());
const activityIsToday = client.lastActivityAt
  ? kyivDayFromISO(client.lastActivityAt) === todayKyivDayForDots
  : false;
const lastMessageAtToday = client.lastMessageAt
  ? kyivDayFromISO(client.lastMessageAt) === todayKyivDayForDots
  : false;

const showMessageDot = hasActivity('message');
const showPaidDot = hasPrefix('paidService');
const showConsultDot = hasPrefix('consultation');
const showMasterDot = isActiveMode && activityIsToday && Boolean(
  hasActivity('masterId') ||
    hasPrefix('serviceMaster') ||
    hasPrefix('consultationMaster')
);
const paidAttendanceChanged = Boolean(hasActivity('paidServiceAttended') || hasActivity('paidServiceCancelled'));
const paidDateChanged = Boolean(hasActivity('paidServiceDate'));
const paidRecordCreatedChanged = Boolean(hasActivity('paidServiceRecordCreatedAt'));
const consultAttendanceChanged = Boolean(
  hasActivity('consultationAttended') || hasActivity('consultationCancelled')
);
const consultDateChanged = Boolean(hasActivity('consultationBookingDate'));
const consultRecordCreatedChanged = Boolean(hasActivity('consultationRecordCreatedAt'));
// Одна крапочка на клієнта: winningKey — подія з найновішим часом сьогодні (щоб крапка переїжджала при створенні запису після повідомлення).
// Якщо дат немає — fallback на пріоритет за списком.
const DOT_PRIORITY: string[] = [
  'statusId', 'chatStatusId', 'message', 'binotel_call',
  'consultationAttended', 'consultationCancelled', 'consultationBookingDate', 'consultationRecordCreatedAt',
  'paidServiceAttended', 'paidServiceCancelled', 'paidServiceDate', 'paidServiceRecordCreatedAt',
  'paidServiceTotalCost',
];
const inTodayBlock = activityIsToday || lastMessageAtToday;
const getKeyDate = (key: string): number | null => {
  const raw =
    key === 'message' ? client.lastMessageAt
    : key === 'consultationRecordCreatedAt' ? (client as any).consultationRecordCreatedAt
    : key === 'consultationBookingDate' ? client.consultationBookingDate
    : (key === 'consultationAttended' || key === 'consultationCancelled') ? (client as any).consultationAttendanceSetAt
    : key === 'statusId' ? client.statusSetAt
    : key === 'chatStatusId' ? (client as any).chatStatusSetAt
    : key === 'binotel_call' ? (client as any).binotelLatestCallStartTime
    : key === 'paidServiceRecordCreatedAt' ? (client as any).paidServiceRecordCreatedAt
    : key === 'paidServiceDate' ? client.paidServiceDate
    : (key === 'paidServiceAttended' || key === 'paidServiceCancelled') ? (client as any).paidServiceAttendanceSetAt
    : null;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
};
const candidateKeys = isActiveMode && inTodayBlock
  ? DOT_PRIORITY.filter((k) => hasActivity(k) || (
      k === 'message' && lastMessageAtToday ||
      (k === 'consultationRecordCreatedAt' && (client as any).consultationRecordCreatedAt && kyivDayFromISO(String((client as any).consultationRecordCreatedAt)) === todayKyivDayForDots) ||
      (k === 'consultationBookingDate' && client.consultationBookingDate && kyivDayFromISO(String(client.consultationBookingDate)) === todayKyivDayForDots) ||
      (k === 'statusId' && client.statusSetAt && kyivDayFromISO(String(client.statusSetAt)) === todayKyivDayForDots) ||
      (['consultationAttended', 'consultationCancelled'].includes(k) && (client as any).consultationAttendanceSetAt && kyivDayFromISO(String((client as any).consultationAttendanceSetAt)) === todayKyivDayForDots) ||
      (k === 'paidServiceRecordCreatedAt' && (client as any).paidServiceRecordCreatedAt && kyivDayFromISO(String((client as any).paidServiceRecordCreatedAt)) === todayKyivDayForDots) ||
      (k === 'paidServiceDate' && client.paidServiceDate && kyivDayFromISO(String(client.paidServiceDate)) === todayKyivDayForDots)
    ))
  : [];
const winningKeyByTime = candidateKeys.length > 0
  ? candidateKeys.reduce<{ key: string; ts: number } | null>((best, k) => {
      const ts = getKeyDate(k);
      if (ts == null) return best;
      if (!best || ts > best.ts) return { key: k, ts };
      return best;
    }, null)?.key ?? null
  : null;
let fallbackKey: string | null = null;
if (isActiveMode && inTodayBlock && !winningKeyByTime) {
  if (lastMessageAtToday) {
    fallbackKey = 'message';
  } else {
  const consultSetToday = (client as any).consultationAttendanceSetAt
    && kyivDayFromISO(String((client as any).consultationAttendanceSetAt)) === todayKyivDayForDots;
  const statusSetToday = client.statusSetAt
    && kyivDayFromISO(String(client.statusSetAt)) === todayKyivDayForDots;
  if (consultSetToday && (client.consultationAttended !== null || (client as any).consultationCancelled)) {
    fallbackKey = (client as any).consultationCancelled ? 'consultationCancelled' : 'consultationAttended';
  } else if (statusSetToday) {
    fallbackKey = 'statusId';
  } else if (client.paidServiceDate && (client.paidServiceAttended !== null || (client as any).paidServiceCancelled)) {
    const paidCreatedAt = (client as any).paidServiceRecordCreatedAt;
    const paidCreatedToday = paidCreatedAt && kyivDayFromISO(String(paidCreatedAt)) === todayKyivDayForDots;
    if (paidCreatedToday) fallbackKey = (client as any).paidServiceCancelled ? 'paidServiceCancelled' : 'paidServiceAttended';
    else fallbackKey = (client as any).paidServiceCancelled ? 'paidServiceCancelled' : 'paidServiceAttended';
  } else if ((client as any).consultationRecordCreatedAt && kyivDayFromISO(String((client as any).consultationRecordCreatedAt)) === todayKyivDayForDots) {
    fallbackKey = 'consultationRecordCreatedAt';
  } else if (client.consultationBookingDate && kyivDayFromISO(String(client.consultationBookingDate)) === todayKyivDayForDots) {
    fallbackKey = 'consultationBookingDate';
  }
  }
}
const winningKey = winningKeyByTime ?? fallbackKey;
const showStatusDot = winningKey === 'statusId';
const kyivDayFmtRow = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const todayKyivDayRow = kyivDayFmtRow.format(new Date());
const updatedKyivDayRow = client.updatedAt ? kyivDayFmtRow.format(new Date(client.updatedAt)) : '';

const showBorder = isActiveMode
  ? index === todayBlockRowIndices.firstTodayIndex
  : index === todayBlockRowIndices.firstCreatedTodayIndex;
return (
    <tr
      ref={measureElement}
      data-index={virtualRow ? virtualRow.index : undefined}
      style={
        virtualRow
          ? {
              position: "absolute",
              top: 0,
              left: 0,
              width: `${bodyTableTotalWidthPx}px`,
              display: "table",
              tableLayout: "fixed",
              transform: `translateY(${virtualRow.start}px)`,
            }
          : undefined
      }
      className={showBorder ? "border-b-[3px] border-gray-300" : ""}
    >
  <td className="pl-0 pr-0.5 py-1 text-xs text-left tabular-nums" style={cellPx("number", getStickyColumnStyle(columnWidths.number, getStickyLeft(0), false))}>{index + 1}</td>
  <td className="px-0 py-1 text-xs whitespace-nowrap" style={cellPx("act", getStickyColumnStyle(columnWidths.act, getStickyLeft(1), false))}>
    <span className="flex flex-col leading-none">
      <span
        title={
          (() => {
            const keys = (client.lastActivityKeys ?? []).join(', ') || '-';
            const at = (client.lastActivityAt || '').toString().trim() || '-';
            if (!debugActivity) return `lastActivityAt: ${at}\nlastActivityKeys: ${keys}`;
            return [
              `lastActivityAt: ${at}`,
              `lastActivityKeys: ${keys}`,
              `clientId: ${String(client.id).slice(0, 18)}`,
              `altegioClientId: ${client.altegioClientId ?? '-'}`,
              `state: ${client.state ?? '-'}`,
              `masterId: ${client.masterId ?? '-'}`,
            ].join('\n');
          })()
        }
      >
        {(() => {
          const u = client.updatedAt ? new Date(client.updatedAt).getTime() : 0;
          const m = client.lastMessageAt ? new Date(client.lastMessageAt).getTime() : 0;
          const effectiveAct = Math.max(u, m);
          const effectiveActDate = Number.isFinite(effectiveAct) && effectiveAct > 0 ? new Date(effectiveAct).toISOString() : null;
          return effectiveActDate ? formatDateShortYear(effectiveActDate) : '-';
        })()}
      </span>
      {debugActivity ? (
        <span className="mt-0.5 text-[10px] leading-none opacity-70 max-w-[120px] truncate">
          keys: {(client.lastActivityKeys ?? []).join(', ') || '-'}
        </span>
      ) : null}
      <span className="opacity-70">{client.createdAt ? formatDateShortYear(client.createdAt) : '-'}</span>
    </span>
  </td>
  {/* Фіксований кружок-слот, максимально близько до колонки дат */}
  <td className="px-0 py-1" style={cellPx("avatar", getStickyColumnStyle(columnWidths.avatar, getStickyLeft(2), false))}>
    {(() => {
      const username = (client.instagramUsername || "").toString();
      const isNoInstagram =
        username === "NO INSTAGRAM" || username.startsWith("no_instagram_");
      const isMissingInstagram = username.startsWith("missing_instagram_");
      const isNormalInstagram = Boolean(username) && !isNoInstagram && !isMissingInstagram;
      const avatarSrc = isNormalInstagram
        ? `/api/admin/direct/instagram-avatar?username=${encodeURIComponent(username)}`
        : null;

      return (
        <AvatarSlot
          avatarSrc={avatarSrc}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
          onClick={avatarSrc ? () => setFullscreenAvatar({ src: avatarSrc, username }) : undefined}
        />
      );
    })()}
  </td>
  <td className="pl-0 pr-1 sm:pr-1.5 py-1 text-xs whitespace-nowrap overflow-hidden" style={cellPx("name", getStickyColumnStyle(columnWidths.name, getStickyLeft(3), false))}>
    <span className="flex flex-col leading-none min-w-0">
      {(() => {
        const first = (client.firstName || "").toString().trim();
        const last = (client.lastName || "").toString().trim();
        const hasName = Boolean(first || last);
        const fullName = getFullName(client);

        const username = (client.instagramUsername || "").toString();
        const isNoInstagram =
          username === "NO INSTAGRAM" || username.startsWith("no_instagram_");
        const isMissingInstagram = username.startsWith("missing_instagram_");
        const isNormalInstagram = Boolean(username) && !isNoInstagram && !isMissingInstagram;

        const invalidIgLabel = isNoInstagram
          ? "NO"
          : isMissingInstagram
            ? "missing"
            : null;

        // Бейдж “Лід/Клієнт” має змінюватись автоматично, коли зʼявляється Altegio ID
        const isClientType = Boolean(client.altegioClientId);
        // Динамічне обчислення spend з колонки "Продажі" (client.spent)
        // Цифри в бейджах оновлюються автоматично при зміні spend
        const spendRaw = (client.spent ?? 0) as unknown;
        const spendValue = (() => {
          if (typeof spendRaw === "string") {
            const cleaned = spendRaw.replace(/\s+/g, "");
            const num = Number(cleaned);
            return Number.isFinite(num) ? num : 0;
          }
          const num = Number(spendRaw);
          return Number.isFinite(num) ? num : 0;
        })();
        // Умови відображення бейджів
        const spendShowMega = spendValue > 1000000;
        const spendShowStar = spendValue >= 100000;
        const spendShowCircleTen = spendValue >= 20000 && spendValue < 100000;
        const spendShowCircleOne = spendValue >= 10000 && spendValue < 20000;
        const spendShowCircleEmpty = spendValue < 10000;
        // Динамічне обчислення цифр для кружечків (десятки тисяч: 20k-90k)
        const spendCircleRaw = Math.floor(spendValue / 10000);
        const spendCircleNumber = Math.min(9, Math.max(2, spendCircleRaw));
        // Динамічне обчислення цифр для зірок (сотні тисяч: 100k-900k)
        const spendStarRaw = Math.floor(spendValue / 100000);
        const spendStarNumber = Math.min(9, Math.max(1, spendStarRaw));
        const spendShowStarNumber = spendValue > 200000;
        const typeBadgeTitle = isClientType
          ? "Клієнт (є Altegio ID)"
          : "Лід (ще без Altegio ID)";
        const typeBadgeTitleWithId = isClientType
          ? `Altegio ID: ${client.altegioClientId}`
          : typeBadgeTitle;
        // debug logs removed
        if (!hasName) {
          const visitsValue =
            client.visits !== null && client.visits !== undefined ? client.visits : null;
          const visitsSuffix = visitsValue !== null ? `(${visitsValue})` : "";
          const instagramUrl = `https://instagram.com/${username}`;
          const phoneQuery = (client.phone || "").toString().trim();
          const fallbackNameQuery = (fullName && fullName !== "-" ? fullName : "").toString().trim();
          const fallbackIgQuery = isNormalInstagram ? username : "";
          const altegioSearchQuery = isClientType
            ? (phoneQuery || fallbackNameQuery || fallbackIgQuery)
            : (fallbackNameQuery || fallbackIgQuery);
          const altegioUrl = buildAltegioClientsSearchUrl(altegioSearchQuery);
          // Активний режим: sortBy === 'updatedAt' && sortOrder === 'desc'
          const isActiveMode = sortBy === 'updatedAt' && sortOrder === 'desc';
          // Формуємо tooltip з інформацією про трігер (тільки для активного режиму)
          let tooltipText = `${typeBadgeTitleWithId}\nВідкрити в Altegio (Клієнтська база)`;
          if (isActiveMode) {
            // Перевіряємо, чи є lastActivityKeys
            if (client.lastActivityKeys && Array.isArray(client.lastActivityKeys) && client.lastActivityKeys.length > 0) {
              const triggerDesc = getTriggerDescription(client.lastActivityKeys);
              if (triggerDesc) {
                const activityDate = formatActivityDate(client.lastActivityAt);
                tooltipText += `\n\nТрігер: ${triggerDesc}`;
                if (activityDate) {
                  tooltipText += `\nДата: ${activityDate}`;
                }
              }
              // Якщо getTriggerDescription повернув порожній рядок - нічого не показуємо
            }
            // Якщо lastActivityKeys відсутні або порожні - нічого не показуємо
          }
          const typeBadge = isClientType ? (
            <a
              href={altegioUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 hover:opacity-80 transition-opacity"
              title={tooltipText}
              aria-label={`${typeBadgeTitleWithId}. Відкрити в Altegio`}
              onClick={(e) => e.stopPropagation()}
            >
            {spendShowMega ? (
              <SpendMegaBadge />
            ) : spendShowStar ? (
              <SpendStarBadge
                size={spendShowStarNumber ? 22 : 18}
                number={spendShowStarNumber ? spendStarNumber : undefined}
                fontSize={spendShowStarNumber ? 8 : 12}
              />
            ) : spendShowCircleTen ? (
              <SpendCircleBadge number={spendCircleNumber} />
            ) : spendShowCircleOne ? (
              <SpendCircleBadge number={1} />
            ) : spendShowCircleEmpty ? (
              <SpendCircleBadge />
            ) : (
              <ClientBadgeIcon />
            )}
            </a>
          ) : (
            <a
              href={instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
              title="Клік для копіювання Instagram username"
              aria-label="Копіювати Instagram username"
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const usernameToCopy = client.instagramUsername?.trim();
                if (usernameToCopy && usernameToCopy !== "NO INSTAGRAM" && !usernameToCopy.startsWith("no_instagram_") && !usernameToCopy.startsWith("missing_instagram_")) {
                  try {
                    await navigator.clipboard.writeText(usernameToCopy);
                    // Тимчасово змінюємо title для візуального фідбеку
                    const target = e.currentTarget;
                    const originalTitle = target.title;
                    target.title = `Скопійовано: ${usernameToCopy}`;
                    setTimeout(() => {
                      target.title = originalTitle;
                    }, 2000);
                  } catch (err) {
                    console.error('Помилка копіювання:', err);
                    // Fallback для старих браузерів
                    const textArea = document.createElement('textarea');
                    textArea.value = usernameToCopy;
                    textArea.style.position = 'fixed';
                    textArea.style.left = '-999999px';
                    document.body.appendChild(textArea);
                    textArea.select();
                    try {
                      document.execCommand('copy');
                      const target = e.currentTarget;
                      const originalTitle = target.title;
                      target.title = `Скопійовано: ${usernameToCopy}`;
                      setTimeout(() => {
                        target.title = originalTitle;
                      }, 2000);
                    } catch (fallbackErr) {
                      console.error('Помилка fallback копіювання:', fallbackErr);
                    }
                    document.body.removeChild(textArea);
                  }
                }
              }}
            >
              {client.instagramUsername?.startsWith('binotel_') ? <BinotelLeadBadgeIcon /> : <LeadBadgeIcon />}
            </a>
          );

          return (
            <>
              <div className="flex items-center gap-1 min-w-0">
                {typeBadge}
              {isNormalInstagram ? (
                <a
                  href={`https://instagram.com/${username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                    className="link link-primary flex items-center gap-1 min-w-0"
                  title={`https://instagram.com/${username}`}
                  onClick={(e) => e.stopPropagation()}
                >
                    <span className="min-w-0 overflow-hidden">{username}</span>
                    {visitsSuffix ? (
                      <span className="shrink-0 opacity-80">{` ${visitsSuffix}`}</span>
                    ) : null}
                </a>
              ) : (
                  <span className="text-gray-400 flex items-center gap-1 min-w-0" title={username || ""}>
                    <span className="truncate min-w-0">—</span>
                    {visitsSuffix ? (
                      <span className="shrink-0 opacity-80">{` ${visitsSuffix}`}</span>
                    ) : null}
                </span>
              )}
              </div>
              {invalidIgLabel && (
                <span className="mt-0.5 text-[10px] text-red-600 font-semibold leading-none">
                  {invalidIgLabel}
                </span>
              )}
            </>
          );
        }

        const nameOneLine = [first, last].filter(Boolean).join(" ").trim() || fullName;
        const visitsValue =
          client.visits !== null && client.visits !== undefined ? client.visits : null;
        const visitsSuffix = visitsValue !== null ? `(${visitsValue})` : "";
        const instagramUrl = `https://instagram.com/${username}`;
        const phoneQuery = (client.phone || "").toString().trim();
        const fallbackNameQuery = (nameOneLine && nameOneLine !== "-" ? nameOneLine : "").toString().trim();
        const fallbackIgQuery = isNormalInstagram ? username : "";
        const altegioSearchQuery = isClientType
          ? (phoneQuery || fallbackNameQuery || fallbackIgQuery)
          : (fallbackNameQuery || fallbackIgQuery);
        const altegioUrl = buildAltegioClientsSearchUrl(altegioSearchQuery);
        // Активний режим: sortBy === 'updatedAt' && sortOrder === 'desc'
        const isActiveMode = sortBy === 'updatedAt' && sortOrder === 'desc';
        // Формуємо tooltip з інформацією про трігер (тільки для активного режиму)
        let tooltipText = `${typeBadgeTitleWithId}\nВідкрити в Altegio (Клієнтська база)`;
        if (isActiveMode) {
          // Перевіряємо, чи є lastActivityKeys
          if (client.lastActivityKeys && Array.isArray(client.lastActivityKeys) && client.lastActivityKeys.length > 0) {
            const triggerDesc = getTriggerDescription(client.lastActivityKeys);
            if (triggerDesc) {
              const activityDate = formatActivityDate(client.lastActivityAt);
              tooltipText += `\n\nТрігер: ${triggerDesc}`;
              if (activityDate) {
                tooltipText += `\nДата: ${activityDate}`;
              }
            }
            // Якщо getTriggerDescription повернув порожній рядок - нічого не показуємо
          }
          // Якщо lastActivityKeys відсутні або порожні - нічого не показуємо
        }
        const typeBadge = isClientType ? (
          <a
            href={altegioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 hover:opacity-80 transition-opacity"
            title={tooltipText}
            aria-label={`${typeBadgeTitleWithId}. Відкрити в Altegio`}
            onClick={(e) => e.stopPropagation()}
          >
            {spendShowMega ? (
              <SpendMegaBadge />
            ) : spendShowStar ? (
              <SpendStarBadge
                size={spendShowStarNumber ? 22 : 18}
                number={spendShowStarNumber ? spendStarNumber : undefined}
                fontSize={spendShowStarNumber ? 8 : 12}
              />
            ) : spendShowCircleTen ? (
              <SpendCircleBadge number={spendCircleNumber} />
            ) : spendShowCircleOne ? (
              <SpendCircleBadge number={1} />
            ) : spendShowCircleEmpty ? (
              <SpendCircleBadge />
            ) : (
              <ClientBadgeIcon />
            )}
          </a>
        ) : (
          <a
            href={instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
            title="Клік для копіювання Instagram username"
            aria-label="Копіювати Instagram username"
            onClick={async (e) => {
              e.stopPropagation();
              e.preventDefault();
              const usernameToCopy = client.instagramUsername?.trim();
              if (usernameToCopy && usernameToCopy !== "NO INSTAGRAM" && !usernameToCopy.startsWith("no_instagram_") && !usernameToCopy.startsWith("missing_instagram_")) {
                try {
                  await navigator.clipboard.writeText(usernameToCopy);
                  // Тимчасово змінюємо title для візуального фідбеку
                  const target = e.currentTarget;
                  const originalTitle = target.title;
                  target.title = `Скопійовано: ${usernameToCopy}`;
                  setTimeout(() => {
                    target.title = originalTitle;
                  }, 2000);
                } catch (err) {
                  console.error('Помилка копіювання:', err);
                  // Fallback для старих браузерів
                  const textArea = document.createElement('textarea');
                  textArea.value = usernameToCopy;
                  textArea.style.position = 'fixed';
                  textArea.style.left = '-999999px';
                  document.body.appendChild(textArea);
                  textArea.select();
                  try {
                    document.execCommand('copy');
                    const target = e.currentTarget;
                    const originalTitle = target.title;
                    target.title = `Скопійовано: ${usernameToCopy}`;
                    setTimeout(() => {
                      target.title = originalTitle;
                    }, 2000);
                  } catch (fallbackErr) {
                    console.error('Помилка fallback копіювання:', fallbackErr);
                  }
                  document.body.removeChild(textArea);
                }
              }
            }}
          >
            {client.instagramUsername?.startsWith('binotel_') ? <BinotelLeadBadgeIcon /> : <LeadBadgeIcon />}
          </a>
        );

        return (
          <>
            <div className="flex items-center gap-1 min-w-0 max-w-full">
              {typeBadge}
            {isNormalInstagram ? (
              <a
                href={`https://instagram.com/${username}`}
                target="_blank"
                rel="noopener noreferrer"
                  className="link link-primary flex items-center gap-1 min-w-0 max-w-full"
                title={`${nameOneLine} - https://instagram.com/${username}`}
                onClick={(e) => e.stopPropagation()}
              >
                  <span className="min-w-0 truncate" title={nameOneLine}>{nameOneLine}</span>
                  {visitsSuffix ? (
                    <span className="shrink-0 opacity-80">{` ${visitsSuffix}`}</span>
                  ) : null}
              </a>
            ) : (
                <span className="flex items-center gap-1 min-w-0 max-w-full" title={nameOneLine}>
                  <span className="min-w-0 truncate" title={nameOneLine}>{nameOneLine}</span>
                  {visitsSuffix ? (
                    <span className="shrink-0 opacity-80">{` ${visitsSuffix}`}</span>
                  ) : null}
              </span>
            )}
            </div>
            {invalidIgLabel && (
              <span className="mt-0.5 text-[10px] text-red-600 font-semibold leading-none">
                {invalidIgLabel}
              </span>
            )}
          </>
        );
      })()}
    </span>
  </td>
  {!hideSalesColumn && (
    <td className="pl-0 pr-1 sm:pr-1.5 py-1 text-xs whitespace-nowrap" style={cellPx("sales", getColumnStyle(columnWidths.sales, true))}>
      <span className="flex flex-col items-start leading-none">
        <span className="text-left">
          {client.spent !== null && client.spent !== undefined
            ? `${Math.round(client.spent / 1000).toLocaleString('uk-UA')} тис.`
            : '-'}
        </span>
      </span>
    </td>
  )}
  {/* Днів з останнього візиту (після “Продажі”) */}
  <td className="pl-0 pr-1 sm:pr-1 py-1 text-xs whitespace-nowrap tabular-nums text-left" style={cellPx("days", getColumnStyle(columnWidths.days, true))}>
    {(() => {
      const raw = (client as any).daysSinceLastVisit;
      const hasDays = typeof raw === "number" && Number.isFinite(raw);
      const days = hasDays ? (raw as number) : null;
      const lastVisitAt = (client as any).lastVisitAt;

      const cls = (() => {
        if (!hasDays) return "bg-gray-200 text-gray-900";
        if (days! <= 60) return "bg-gray-200 text-gray-900";
        if (days! <= 90) return "bg-amber-200 text-amber-900";
        return "bg-red-200 text-red-900";
      })();

      // Формуємо tooltip з датою останнього візиту (тільки з Altegio API)
      let tooltipText = "";
      if (hasDays) {
        tooltipText = `Днів з останнього візиту: ${days}`;
        if (lastVisitAt) {
          const formattedDate = formatDate(lastVisitAt);
          tooltipText += `\nДата останнього візиту: ${formattedDate}`;
        }
      } else {
        tooltipText = "Днів з останнього візиту: -";
      }

      return (
        <span
          className={`inline-flex items-center justify-start rounded-full px-2 py-0.5 tabular-nums text-[12px] font-normal leading-none ${cls}`}
          title={tooltipText}
        >
          {hasDays ? days : "-"}
        </span>
      );
    })()}
  </td>
  <td className="pl-0 pr-0.5 py-1 align-middle" style={cellPx("communication", getColumnStyle(columnWidths.communication, true))}>
    <CommunicationChannelPicker
      value={client.communicationChannel}
      onChange={async (next) => {
        await onClientUpdate(client.id, { communicationChannel: next });
      }}
    />
  </td>
  {/* Переписка: число повідомлень (клік → історія) + текст-статус */}
  <td
    className={
      chatStatusUiVariant === 'v2'
        ? "pl-0 pr-1 sm:pr-1.5 py-1 text-xs whitespace-normal text-left align-top"
        : "pl-0 pr-1 sm:pr-1.5 py-1 text-xs whitespace-nowrap overflow-hidden text-left align-top"
    }
    style={{ ...cellPx("inst", getColumnStyle(columnWidths.inst, true)), minHeight: instCallsCellMinHeight }}
  >
      {(() => {
      const total =
        typeof (client as any).messagesTotal === 'number' ? (client as any).messagesTotal : 0;
      const needs = Boolean((client as any).chatNeedsAttention);
      const showInstDot = winningKey === 'message';
      const showChatStatusDot = winningKey === 'chatStatusId';
      const statusId = (client.chatStatusId || '').toString().trim();
      const hasStatus = Boolean(statusId);
      const statusNameRaw = ((client as any).chatStatusName || '').toString().trim();
      const showStatus = Boolean(statusNameRaw) && hasStatus;
      const badgeKey = ((client as any).chatStatusBadgeKey || '').toString().trim();
      const badgeCfg = getChatBadgeStyle(badgeKey);

      // debug logs removed
        
      // Фон лічильника НЕ залежить від статусу:
      // - сірий завжди
      // - голубий тільки якщо зʼявились нові
      // НОВЕ ПРАВИЛО:
      // - якщо кількість повідомлень = 0 → сірий фон
      // - якщо статус НЕ встановлено → голубий
      // - якщо статус встановлено і нових нема → сірий
      // - якщо є нові → голубий (незалежно від статусу)
      // Ідентичний “телеграмний” голубий (hex), щоб вигляд був як на скріні
      const countClass =
        total === 0
          ? 'bg-gray-200 text-gray-900'
          : needs || !hasStatus
          ? 'bg-[#2AABEE] text-white'
          : 'bg-gray-200 text-gray-900';

          const lastMessageDateStr = formatDateDDMMYY(client.lastMessageAt);
          return (
        <span className="flex flex-col items-start gap-0.5">
            <div className="flex items-center justify-start gap-2 min-w-0">
            <button
            className={`relative inline-flex items-center justify-center rounded-full px-2 py-0.5 tabular-nums hover:opacity-80 transition-opacity ${countClass} text-[12px] font-normal leading-none`}
            onClick={() => setMessagesHistoryClient(client)}
            title={needs ? 'Є нові повідомлення — відкрити історію' : 'Відкрити історію повідомлень'}
            type="button"
            >
            {total}
            {showInstDot ? (
              <CornerRedDot title="Тригер: нове повідомлення" />
            ) : null}
            </button>

          {showStatus ? (
            <WithCornerRedDot
              show={showChatStatusDot}
              title="Тригер: змінився/встановлений статус переписки"
              dotClassName="-top-[5px] -right-[4px]"
            >
              <span
                className={
                  chatStatusUiVariant === 'v2'
                    ? 'inline-flex min-w-0 max-w-[50px] items-start rounded-full px-2 py-0.5 text-[11px] font-normal leading-[1.05]'
                    : 'inline-flex min-w-0 max-w-[50px] items-center rounded-full px-2 py-0.5 text-[11px] font-normal leading-none overflow-hidden'
                }
                title={statusNameRaw}
                style={{
                  backgroundColor: badgeCfg.bg,
                  color: badgeCfg.fg,
                }}
              >
                {chatStatusUiVariant === 'v2' ? (
                  <span
                    className="min-w-0 break-words overflow-hidden"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {statusNameRaw}
                  </span>
                ) : (
                  <span className="overflow-hidden whitespace-nowrap text-clip">
                    {statusNameRaw}
                  </span>
                )}
              </span>
            </WithCornerRedDot>
          ) : null}
        </div>
            {lastMessageDateStr !== '-' ? (
              <span
                className="text-[10px] leading-none opacity-60"
                title={`Останнє повідомлення: ${lastMessageDateStr}`}
              >
                {lastMessageDateStr}
              </span>
            ) : null}
        </span>
      );
    })()}
  </td>
  <td
    className="pl-0 pr-1.5 sm:pr-2 py-1 text-xs text-left align-top"
    style={{ ...cellPx("calls", getColumnStyle(columnWidths.calls, true)), minHeight: instCallsCellMinHeight }}
  >
    {(client as any).binotelCallsCount != null &&
    (client as any).binotelCallsCount > 0 ? (
      <span
        className="inline-flex flex-col items-start gap-0.5"
        title={formatDateDDMMYYHHMM((client as any).binotelLatestCallStartTime)}
      >
        <span className="inline-flex items-center justify-start gap-1">
          <WithCornerRedDot
            show={winningKey === 'binotel_call'}
            title="Тригер: дзвінок Binotel"
            dotClassName="-top-[5px] -right-[4px]"
          >
            <button
              type="button"
              onClick={() => setBinotelHistoryClient(client)}
              className="inline-flex items-center"
              title={`Історія дзвінків Binotel. Останній: ${formatDateDDMMYYHHMM((client as any).binotelLatestCallStartTime)}`}
            >
              <BinotelCallTypeIcon
                callType={(client as any).binotelLatestCallType || "incoming"}
                success={["ANSWER", "VM-SUCCESS", "SUCCESS"].includes(
                  (client as any).binotelLatestCallDisposition || ""
                )}
                size={18}
              />
            </button>
          </WithCornerRedDot>
          {(() => {
            const disp = (client as any).binotelLatestCallDisposition || "";
            const isSuccess = ["ANSWER", "VM-SUCCESS", "SUCCESS"].includes(disp);
            const hasRecording =
              (client as any).binotelLatestCallRecordingUrl ||
              (client as any).binotelLatestCallGeneralID;
            if (!hasRecording || !isSuccess) return null;
            return (
              <PlayRecordingButton
                recordingUrl={(client as any).binotelLatestCallRecordingUrl}
                generalCallID={(client as any).binotelLatestCallGeneralID}
                title="Прослухати останній запис"
                onPlayRequest={(url) => setInlineRecordingUrl(url)}
                listenDisabled={!canListenCalls}
              />
            );
          })()}
        </span>
        {(() => {
          const startTime = (client as any).binotelLatestCallStartTime;
          const dateStr = formatDateDDMMYY(startTime);
          if (dateStr === '-') return null;
          return (
            <span
              className="text-[10px] leading-none opacity-60"
              title={formatDateDDMMYYHHMM(startTime)}
            >
              {dateStr}
            </span>
          );
        })()}
      </span>
    ) : null}
  </td>
  <td
    className="pl-0 pr-1.5 sm:pr-2 py-1 text-xs text-left align-top"
    style={cellPx("callStatus", getColumnStyle(columnWidths.callStatus, true))}
  >
    {(client.altegioClientId || client.instagramUsername?.startsWith('binotel_')) ? (
      <DirectStatusCell
        client={client}
        statuses={statuses}
        showDot={showStatusDot}
        dotTitle="Тригер: змінився/встановлений статус"
        onStatusChange={async (u) => {
          await onClientUpdate(u.clientId, {
            statusId: u.statusId,
            ...(client.instagramUsername && { _fallbackInstagram: client.instagramUsername }),
          });
        }}
        onMenuOpen={onStatusMenuOpen}
      />
    ) : null}
  </td>
  <td className="pl-0 pr-2 sm:pr-2.5 py-1 text-xs whitespace-nowrap text-left align-top" style={cellPx("state", getColumnStyle(columnWidths.state, true))}>
    {(() => {
      const kyivDayFmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const todayKyivDay = kyivDayFmt.format(new Date()); // YYYY-MM-DD

      const parseMaybeIsoDate = (raw: any): Date | null => {
        if (!raw) return null;
        const dateValue = typeof raw === 'string' ? raw.trim() : String(raw);
        const isoDateMatch = dateValue.match(
          /\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[\+\-]\d{2}:\d{2})?)?/
        );
        const d = new Date(isoDateMatch ? isoDateMatch[0] : dateValue);
        return isNaN(d.getTime()) ? null : d;
      };

      // Консультація (календар) — привʼязуємо до consultationBookingDate
      const consultDate = parseMaybeIsoDate(client.consultationBookingDate);
      const consultKyivDay = consultDate ? kyivDayFmt.format(consultDate) : null;
      const consultIsActive = Boolean(consultKyivDay && consultKyivDay >= todayKyivDay);

      // Платна послуга (нарощування/інші) — привʼязуємо до paidServiceDate
      const paidDate = client.paidServiceDate ? new Date(client.paidServiceDate) : null;
      const paidKyivDay = paidDate && !isNaN(paidDate.getTime()) ? kyivDayFmt.format(paidDate) : null;
      const paidIsActive = Boolean(paidKyivDay && paidKyivDay >= todayKyivDay);

      // “Минуле/сьогодні” для послуги: якщо дата ≤ сьогодні (Kyiv) — замість іконки послуги показуємо
      // або Перезапис (🔁), або відповідний статус (без залежності від ✅/❓/❌ і навіть якщо 🚫).
      const consultPastOrToday = Boolean(consultKyivDay && consultKyivDay <= todayKyivDay);
      const paidPastOrToday = Boolean(paidKyivDay && paidKyivDay <= todayKyivDay);

      // “Перезапис” — використовуємо існуючу логіку з колонки дат
      const hasPaidReschedule = Boolean((client as any).paidServiceIsRebooking);
      const hasConsultReschedule =
        (typeof client.consultationAttemptNumber === 'number' && client.consultationAttemptNumber >= 2) ||
        (Array.isArray(client.last5States) &&
          client.last5States.some((s: any) => (s?.state || '') === 'consultation-rescheduled'));
          
        
      // 2) Нормальний режим: показуємо ТІЛЬКИ 1 значок у колонці “Стан”.
      // Пріоритет: платний запис (якщо актуальний) → інакше консультація (якщо актуальна).
      // Без 🆕/💸 — це створювало “NEW” і візуальний хаос.
      // Спрощена логіка: якщо є платна послуга - показуємо її стан, якщо немає - показуємо стан консультації
      
      // Перевірка строго минулих дат (не включаючи сьогодні)
      const isPaidPast = Boolean(paidKyivDay && paidKyivDay < todayKyivDay);
      const isConsultPast = Boolean(consultKyivDay && consultKyivDay < todayKyivDay);

      // Нова логіка відображення стану (див. .cursor/rules/direct-state-icons.mdc)
      const isPaidFutureOrToday = Boolean(paidKyivDay && paidKyivDay >= todayKyivDay);
      const isPaidToday = Boolean(paidKyivDay && paidKyivDay === todayKyivDay);

      const stateDatePaid = formatDateDDMMYY(client.paidServiceRecordCreatedAt);
      const stateDateConsult = formatDateDDMMYY(client.consultationRecordCreatedAt);
      const stateDateLead = formatDateDDMMYY(client.firstContactDate || client.createdAt);

      // 1. 🔥 Вогник — та сама формула, що F4 у статистиці (див. direct-f4-client-match)
      if (clientShowsF4SoldFireNow(client)) {
        const title = stateDatePaid !== '-' ? `Новий клієнт (F4): перший платний запис у місяці. Дата встановлення: ${stateDatePaid}` : "Новий клієнт (F4): перший платний запис у місяці. Натисніть для історії станів";
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center justify-center">
              <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                <span className="text-[24px] leading-none inline-flex items-center justify-center">🔥</span>
              </button>
            </span>
            {stateDatePaid !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDatePaid}</span>}
          </div>
        );
      }

      // 2. Червона дата (букінгдата < сьогодні) → ⚠️ Жовтий трикутник
      if (client.paidServiceDate && isPaidPast) {
        const title = stateDatePaid !== '-' ? `Букінгдата в минулому. Дата встановлення: ${stateDatePaid}` : "Букінгдата в минулому. Натисніть для історії станів";
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center justify-center">
              <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                <span className="text-[20px] leading-none inline-flex items-center justify-center">⚠️</span>
              </button>
            </span>
            {stateDatePaid !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDatePaid}</span>}
          </div>
        );
      }

      // 3. Червона дата + немає перезапису (no-show або cancelled) — ⚠️ окремо обробляється нижче

      // 4. 🔁 Перезапис — дата створення поточного запису = букінгдата попереднього (paidServiceIsRebooking)
      if (
        client.paidServiceDate &&
        isPaidToday &&
        hasPaidReschedule &&
        !client.paidServiceCancelled &&
        client.paidServiceAttended !== false
      ) {
        const title = stateDatePaid !== '-' ? `Перезапис. Дата встановлення: ${stateDatePaid}` : "Перезапис: дата створення = букінг-день попереднього. Натисніть для історії станів";
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center justify-center">
              <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                <span className="text-[18px] leading-none inline-flex items-center justify-center">🔁</span>
              </button>
            </span>
            {stateDatePaid !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDatePaid}</span>}
          </div>
        );
      }

      // 5. 🔁 Перезапис на майбутнє — та сама умова paidServiceIsRebooking
      if (
        client.paidServiceDate &&
        isPaidFutureOrToday &&
        hasPaidReschedule &&
        !client.paidServiceCancelled &&
        client.paidServiceAttended !== false
      ) {
        const title = stateDatePaid !== '-' ? `Перезапис на майбутнє. Дата встановлення: ${stateDatePaid}` : "Перезапис на майбутнє. Натисніть для історії станів";
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center justify-center">
              <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                <span className="text-[18px] leading-none inline-flex items-center justify-center">🔁</span>
              </button>
            </span>
            {stateDatePaid !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDatePaid}</span>}
          </div>
        );
      }

      // 6. Букінгдата сьогодні або в майбутньому → ⏳ (винятки: 🔥 Продаж, 🔁 Перезапис — вже оброблені)
      if (client.paidServiceDate && isPaidFutureOrToday) {
        const title = stateDatePaid !== '-' ? `Очікування. Дата встановлення: ${stateDatePaid}` : "Очікування: букінгдата сьогодні або в майбутньому. Натисніть для історії станів";
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center justify-center">
              <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                <span className="text-[20px] leading-none inline-flex items-center justify-center">⏳</span>
              </button>
            </span>
            {stateDatePaid !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDatePaid}</span>}
          </div>
        );
      }

      // 3. Не з'явився на консультацію
      if (
        client.consultationBookingDate &&
        isConsultPast &&
        (!client.paidServiceDate || !client.signedUpForPaidService) &&
        (client.consultationAttended === false || client.state === 'consultation-no-show')
      ) {
        const noShowIso =
          (client as any).consultationAttendanceSetAt ??
          client.consultationRecordCreatedAt ??
          client.consultationBookingDate;
        const stateDateNoShow = formatDateDDMMYY(noShowIso);
        const title = stateDateNoShow !== '-' ? `Не з'явився на консультацію. Дата встановлення: ${stateDateNoShow}` : "Не з'явився на консультацію. Натисніть для історії станів";
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center justify-center">
              <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                <StateIcon state="consultation-no-show" size={28} />
              </button>
            </span>
            {stateDateNoShow !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateNoShow}</span>}
          </div>
        );
      }

      // 4. Успішна консультація без запису (Не продали)
      if (client.consultationAttended === true && isConsultPast && (!client.paidServiceDate || !client.signedUpForPaidService)) {
        // Дата під 💔: спочатку коли встановлено відвідування, потім створення запису в Altegio, потім дата букінгу
        const neProdalyIso =
          (client as any).consultationAttendanceSetAt ??
          client.consultationRecordCreatedAt ??
          client.consultationBookingDate;
        const stateDateNeProdaly = formatDateDDMMYY(neProdalyIso);
        const title = stateDateNeProdaly !== '-' ? `Не продали. Дата встановлення: ${stateDateNeProdaly}` : "Не продали. Натисніть для історії станів";
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center justify-center">
              <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                <span className="text-[24px] leading-none inline-flex items-center justify-center">💔</span>
              </button>
            </span>
            {stateDateNeProdaly !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateNeProdaly}</span>}
          </div>
        );
      }

      // 5. Консультація з минулою датою + відсутній платний запис — рожевий календар
      if (
        client.consultationBookingDate &&
        isConsultPast &&
        (!client.paidServiceDate || !client.signedUpForPaidService)
      ) {
        const title = stateDateConsult !== '-' ? `Консультація з минулою датою. Дата встановлення: ${stateDateConsult}` : "Консультація з минулою датою (немає платного запису)";
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center justify-center">
              <button type="button" className="hover:opacity-70 transition-opacity" title={title} onClick={() => setStateHistoryClient(client)}>
                <StateIcon state="consultation-past" size={28} />
              </button>
            </span>
            {stateDateConsult !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateConsult}</span>}
          </div>
        );
      }

      // 6. Якщо немає платної послуги, але є консультація - показуємо стан консультації
      if (client.consultationBookingDate) {
        const title = stateDateConsult !== '-' ? `Консультація. Дата встановлення: ${stateDateConsult}` : "Консультація";
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center justify-center">
              <button type="button" className="hover:opacity-70 transition-opacity" title={title} onClick={() => setStateHistoryClient(client)}>
                <StateIcon state="consultation-booked" size={28} />
              </button>
            </span>
            {stateDateConsult !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateConsult}</span>}
          </div>
        );
      }

      // Binotel-лід: магентова хмарка (#AF0087)
      if (client.state === 'binotel-lead') {
        const title = stateDateLead !== '-' ? `Binotel-лід (дзвінок). Дата: ${stateDateLead}` : "Binotel-лід (дзвінок з номера без клієнта в Direct)";
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center justify-center">
              <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                <StateIcon state="binotel-lead" size={28} />
              </button>
            </span>
            {stateDateLead !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateLead}</span>}
          </div>
        );
      }

      // Лід без консультації/запису: Новий лід (синя хмарка) — перший контакт сьогодні; зелена — з наступного дня
      if (!client.altegioClientId && !client.paidServiceDate && !client.consultationBookingDate) {
        const firstDate = client.firstContactDate || client.createdAt;
        const firstDateObj = firstDate ? new Date(firstDate) : null;
        if (firstDateObj && !isNaN(firstDateObj.getTime())) {
          const kyivDayFmtLead = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Kyiv',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          });
          const todayKyivStr = kyivDayFmtLead.format(new Date());
          const firstKyivStr = kyivDayFmtLead.format(firstDateObj);
          const todayStart = new Date(todayKyivStr + 'T00:00:00.000Z').getTime();
          const firstStart = new Date(firstKyivStr + 'T00:00:00.000Z').getTime();
          const daysSinceFirst = Math.floor((todayStart - firstStart) / 86400000);
          if (daysSinceFirst === 0) {
            const title = stateDateLead !== '-' ? `Новий лід. Дата встановлення: ${stateDateLead}` : "Новий лід (перший контакт сьогодні). Натисніть для історії станів";
            return (
              <div className="flex flex-col items-start gap-0.5">
                <span className="inline-flex items-center justify-center">
                  <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                    <StateIcon state="new-lead" size={28} />
                  </button>
                </span>
                {stateDateLead !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateLead}</span>}
              </div>
            );
          }
          const title = stateDateLead !== '-' ? `Повідомлення / Лід. Дата встановлення: ${stateDateLead}` : "Повідомлення / Лід (перший контакт раніше). Натисніть для історії станів";
          return (
            <div className="flex flex-col items-start gap-0.5">
              <span className="inline-flex items-center justify-center">
                <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                  <StateIcon state="message" size={28} />
                </button>
              </span>
              {stateDateLead !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateLead}</span>}
            </div>
          );
        }
      }

      return '';
      })()}
  </td>
  {(() => {
    // Перевіряємо, чи консультація створена сьогодні та чи має сьогоднішню дату (для фону колонки)
    const kyivDayFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayKyivDay = kyivDayFmt.format(new Date());
    
    const consultCreatedAtDate = client.consultationRecordCreatedAt
      ? new Date(client.consultationRecordCreatedAt)
      : null;
    const consultCreatedToday = consultCreatedAtDate && !isNaN(consultCreatedAtDate.getTime())
      ? kyivDayFmt.format(consultCreatedAtDate) === todayKyivDay
      : false;
    
    // Перевіряємо, чи дата консультації = сьогодні (для зеленого фону)
    const consultIsToday = client.consultationBookingDate
      ? (() => {
          try {
            const dateValue = typeof client.consultationBookingDate === 'string' 
              ? client.consultationBookingDate.trim() 
              : client.consultationBookingDate;
            const dateStr = typeof dateValue === 'string' ? dateValue : String(dateValue);
            const isoDateMatch = dateStr.match(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[\+\-]\d{2}:\d{2})?)?/);
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
      <td className="pl-0 pr-1 sm:pr-1.5 py-1 text-xs whitespace-nowrap text-left" style={cellPx("consultation", getColumnStyle(columnWidths.consultation, true))}>
    {client.consultationBookingDate ? (
      (() => {
        try {
          // Перевіряємо, чи це не масив або кілька дат
          const dateValue = typeof client.consultationBookingDate === 'string' 
            ? client.consultationBookingDate.trim() 
            : client.consultationBookingDate;
          
          // Витягуємо тільки дату (ISO формат: YYYY-MM-DDTHH:mm:ss.sssZ або подібний)
          // Відкидаємо все, що не схоже на дату
          let dateStr = typeof dateValue === 'string' ? dateValue : String(dateValue);
          
          // Шукаємо ISO дату в рядку (YYYY-MM-DD або YYYY-MM-DDTHH:mm:ss)
          const isoDateMatch = dateStr.match(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[\+\-]\d{2}:\d{2})?)?/);
          if (!isoDateMatch) {
            // Якщо не знайшли ISO формат, спробуємо інші формати
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
            console.warn('[DirectClientTable] Invalid consultationBookingDate:', client.consultationBookingDate);
            return "";
          }
          
          // Порівнюємо по дню в Europe/Kyiv (як і для платних записів),
          // щоб “сьогодні” рахувалось як минуле/сьогоднішнє, а не майбутнє.
          const kyivDayFmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Kyiv',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          });
          const todayKyivDay = kyivDayFmt.format(new Date()); // YYYY-MM-DD
          const consultKyivDay = kyivDayFmt.format(appointmentDate); // YYYY-MM-DD
          const isPast = consultKyivDay < todayKyivDay;
          const isToday = consultKyivDay === todayKyivDay;
          const isPastOrToday = consultKyivDay <= todayKyivDay;
          const formattedDateStr = formatDateShortYear(dateStr);
          const isOnline = client.isOnlineConsultation || false;
          
          // Форматуємо дату створення запису для tooltip (коли створено запис в Altegio)
          const createdAtDate = client.consultationRecordCreatedAt
            ? new Date(client.consultationRecordCreatedAt)
            : null;
          const createdAtStr = createdAtDate && !isNaN(createdAtDate.getTime())
            ? createdAtDate.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : null;
          // Перевіряємо, чи запис створено сьогодні
          const consultCreatedToday = createdAtDate && !isNaN(createdAtDate.getTime())
            ? kyivDayFmt.format(createdAtDate) === todayKyivDay
            : false;
          
          // Діагностика для "Юлія Кобра" та "Топоріна Олена"
          const isDebugClient = client.instagramUsername === 'kobra_best' || 
                               client.instagramUsername === 'olena_toporina' ||
                               (client.firstName === 'Юлія' && client.lastName === 'Кобра') ||
                               (client.firstName === 'Топоріна' && client.lastName === 'Олена');
          
          if (isDebugClient) {
            console.log(`[DirectClientTable] 🔍 Діагностика для ${client.instagramUsername || 'unknown'}:`, {
              clientId: client.id,
              instagramUsername: client.instagramUsername,
              firstName: client.firstName,
              lastName: client.lastName,
              consultationBookingDate: client.consultationBookingDate,
              consultationBookingDateType: typeof client.consultationBookingDate,
              isOnlineConsultation: client.isOnlineConsultation,
              isOnlineConsultationType: typeof client.isOnlineConsultation,
              isOnline: isOnline,
              dateStr: formattedDateStr,
              extractedDateStr: dateStr,
              dateValue,
              paidServiceDate: client.paidServiceDate,
              signedUpForPaidService: client.signedUpForPaidService,
              fullClient: client,
            });
          }
          
          // Визначаємо значок attendance
          // Правило:
          // - ✅/❌/🚫 показуємо тільки для минулих дат (не для майбутніх!)
          // - Виняток: attendance=2 (підтвердив запис) — синю галочку показуємо і для майбутніх дат
          // - ⏳ показуємо у день консультації та для майбутніх, якщо attendance ще нема
          // - ❓ показуємо лише з наступного дня (коли дата < сьогодні, Kyiv) і attendance ще нема
          const consultStatusDateEst = formatDateDDMMYYHHMM(client.consultationAttendanceSetAt ?? client.consultationRecordCreatedAt);
          const attIconCls = "text-[14px] leading-none";
          const consultAttendanceValue = (client as any).consultationAttendanceValue;
          const showConsultCheck = consultAttendanceValue === 2 ? true : (isPast || isToday);
          let attendanceIcon = null;
          if (client.consultationCancelled) {
            attendanceIcon = (
              <span className={`text-orange-600 ${attIconCls}`} title={consultStatusDateEst !== '-' ? `Скасовано до дати консультації. Дата встановлення статусу: ${consultStatusDateEst}` : "Скасовано до дати консультації"}>
                🚫
              </span>
            );
          } else if (client.consultationAttended === true && showConsultCheck) {
            const isConfirmed = consultAttendanceValue === 2;
            attendanceIcon = (
              <span
                className={`inline-flex items-center justify-center ${attIconCls}`}
                title={consultStatusDateEst !== '-' ? `${isConfirmed ? 'Клієнтка підтвердила запис на консультацію' : 'Клієнтка прийшла на консультацію'}. Дата встановлення статусу: ${consultStatusDateEst}` : (isConfirmed ? 'Клієнтка підтвердила запис на консультацію' : 'Клієнтка прийшла на консультацію')}
              >
                {isConfirmed ? (
                  <ConfirmedCheckIcon size={17} />
                ) : (
                  <span className="text-[14px] leading-none">✅</span>
                )}
              </span>
            );
          } else if ((client.consultationAttended === false || client.state === 'consultation-no-show') && (isPast || isToday)) {
            attendanceIcon = (
              <span className={`text-red-600 ${attIconCls}`} title={consultStatusDateEst !== '-' ? `Клієнтка не з'явилася на консультацію. Дата встановлення статусу: ${consultStatusDateEst}` : "Клієнтка не з'явилася на консультацію"}>
                ❌
              </span>
            );
          } else if (isPast) {
            attendanceIcon = (
              <span
                className={`text-gray-500 ${attIconCls}`}
                title={consultStatusDateEst !== '-' ? `Немає підтвердження відвідування консультації. Дата встановлення статусу: ${consultStatusDateEst}` : "Немає підтвердження відвідування консультації (встановіть attendance в Altegio)"}
              >
                ❓
              </span>
            );
          } else {
            attendanceIcon = (
              <span className={`text-gray-700 ${attIconCls}`} title={consultStatusDateEst !== '-' ? `Присутність: Очікується. Дата встановлення статусу: ${consultStatusDateEst}` : "Присутність: Очікується"}>
                ⏳
              </span>
            );
          }
          
          const baseTitle = isPast 
            ? (isOnline ? "Минулий запис на онлайн-консультацію" : "Минулий запис на консультацію")
            : (isOnline ? "Майбутній запис на онлайн-консультацію" : "Майбутній запис на консультацію");
                              const dateEstablished = formatDateDDMMYYHHMM(client.consultationRecordCreatedAt);
          const dateEstablishedDisplay = formatDateDDMMYY(client.consultationRecordCreatedAt);
          const consultantFull = (client.consultationMasterName || '').toString().trim();
          let tooltipTitle = dateEstablished !== '-'
            ? `${baseTitle}\nЗапис створено: ${dateEstablished}`
            : baseTitle;
          if (consultantFull) {
            tooltipTitle += `\nМайстер: ${consultantFull}`;
          }
          
          const consultAttendanceDotTitle = "Тригер: змінилась присутність консультації";
          const consultDateDotTitle = 'Тригер: змінилась дата консультації';
          // Якщо змінився статус присутності — крапочка біля іконки статусу (синя галочка)
          // Fallback: якщо lastActivityKeys перезаписано пізнішим синком, але статус встановлено сьогодні — показуємо на галочці
          const isConsultStatusSetToday = Boolean(
            client.consultationAttendanceSetAt &&
            kyivDayFromISO(String(client.consultationAttendanceSetAt)) === todayKyivDayForDots
          );
          const hasConsultAttendanceChange =
            hasActivity('consultationAttended') ||
            hasActivity('consultationCancelled') ||
            ((winningKey === 'consultationBookingDate' || winningKey === 'consultationRecordCreatedAt') &&
              (client as any).consultationAttendanceValue === 2 &&
              isConsultStatusSetToday);
          // Крапка біля статусу (⏳/✅/❌), а не біля букінгдати: для consultationBookingDate/consultationRecordCreatedAt показуємо на іконці статусу
          const showDotOnConsultDate = false;
          const consultationWinningKeys = ['consultationAttended', 'consultationCancelled', 'consultationBookingDate', 'consultationRecordCreatedAt'];
          const showConsultAttendanceDotEffective = Boolean(
            (winningKey === 'consultationAttended' || winningKey === 'consultationCancelled') ||
            (winningKey === 'consultationBookingDate' || winningKey === 'consultationRecordCreatedAt') ||
            (hasConsultAttendanceChange && consultationWinningKeys.includes(winningKey ?? ''))
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
                  setRecordHistoryType('consultation');
                  setRecordHistoryClient(client);
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
                    setRecordHistoryType('consultation');
                    setRecordHistoryClient(client);
                  }}
                  disabled={!client.altegioClientId}
                >
                  <span className="inline-flex items-center">
                    <WithCornerRedDot show={showDotOnConsultDate} title={consultDateDotTitle} dotClassName="-top-[5px] -right-[4px]">
                      <span className={`rounded-full px-0 py-0.5 ${
                        consultIsToday ? 'bg-green-200' : consultCreatedToday ? 'bg-gray-200' : ''
                      }`}>
                        {formattedDateStr}{isOnline ? "💻" : "📅"}
                      </span>
                    </WithCornerRedDot>
                  </span>
                </button>{typeof client.consultationAttemptNumber === 'number' &&
                client.consultationAttemptNumber >= 2 ? (
                  <span
                    className="inline-flex items-center justify-center rounded-full bg-white border border-blue-300 text-blue-600 font-bold text-[12px] w-[20px] h-[20px]"
                    title={`Повторна спроба консультації №${client.consultationAttemptNumber}`}
                  >
                    {client.consultationAttemptNumber}
                  </span>
                ) : null}{attendanceIcon ? (
                  <WithCornerRedDot show={showConsultAttendanceDotEffective} title={consultAttendanceDotTitle} dotClassName="-top-[5px] -right-[4px]">
                    {attendanceIcon}
                  </WithCornerRedDot>
                ) : null}
              </span>

              {dateEstablishedDisplay !== '-' ? (
                <span
                  className="text-[10px] leading-none opacity-60 max-w-[220px] sm:max-w-[320px] truncate text-left"
                  title={`Запис створено: ${dateEstablished}${consultantFull ? `\nМайстер: ${consultantFull}` : ''}`}
                >
                  {dateEstablishedDisplay}
                </span>
              ) : null}
            </span>
          );
        } catch (err) {
          console.error('[DirectClientTable] Error formatting consultationBookingDate:', err, client.consultationBookingDate);
          return "";
        }
      })()
    ) : (client as any).consultationDeletedInAltegio ? (
      <span className="text-gray-500 italic" title="Візит/запис видалено в Altegio (404), консультацію очищено">
        Видалено в Altegio
      </span>
    ) : (
      ""
    )}
      </td>
    );
  })()}
  {(() => {
    // Перевіряємо, чи запис платної послуги створено сьогодні (для фону колонки)
    const kyivDayFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayKyivDay = kyivDayFmt.format(new Date());
    const paidCreatedAtDate = client.paidServiceRecordCreatedAt
      ? new Date(client.paidServiceRecordCreatedAt)
      : null;
    const paidCreatedToday = paidCreatedAtDate && !isNaN(paidCreatedAtDate.getTime())
      ? kyivDayFmt.format(paidCreatedAtDate) === todayKyivDay
      : false;
    
    // Перевіряємо, чи дата запису = сьогодні (для зеленого фону)
    const paidIsToday = client.paidServiceDate
      ? kyivDayFmt.format(new Date(client.paidServiceDate)) === todayKyivDay
      : false;
    
    return (
      <td className="pl-0 pr-1 sm:pr-1.5 py-1 text-xs whitespace-nowrap text-left" style={cellPx("record", getColumnStyle(columnWidths.record, true))}>
        {client.signedUpForPaidService && client.paidServiceDate ? (
          (() => {
            const paidKyivDay = kyivDayFmt.format(new Date(client.paidServiceDate)); // YYYY-MM-DD
            const isPast = paidKyivDay < todayKyivDay;
            const isToday = paidKyivDay === todayKyivDay;
            const isPastOrToday = paidKyivDay <= todayKyivDay;
            const dateStr = formatDateShortYear(client.paidServiceDate);
            
            // Форматуємо дату створення запису для tooltip (коли створено запис в Altegio)
            const createdAtStr = paidCreatedAtDate && !isNaN(paidCreatedAtDate.getTime())
              ? paidCreatedAtDate.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
              : null;
        
        // Визначаємо значок attendance
        // Правило:
        // - ✅/❌/🚫 показуємо тільки для минулих дат (не для майбутніх!)
        // - Виняток: attendance=2 (підтвердив запис) — синю галочку показуємо і для майбутніх дат
        // - ⏳ показуємо у день запису та для майбутніх, якщо attendance ще нема
        // - ❓ показуємо лише з наступного дня (коли дата < сьогодні, Kyiv) і attendance ще нема
        const paidStatusDateEst = formatDateDDMMYYHHMM(client.paidServiceAttendanceSetAt ?? client.paidServiceRecordCreatedAt);
        const attIconCls = "text-[14px] leading-none";
        const paidAttendanceValue = (client as any).paidServiceAttendanceValue;
        const showPaidCheck = paidAttendanceValue === 2 ? true : (isPast || isToday);
        let attendanceIcon = null;
        if (client.paidServiceCancelled) {
          attendanceIcon = (
            <span className={`text-orange-600 ${attIconCls}`} title={paidStatusDateEst !== '-' ? `Скасовано до дати запису. Дата встановлення статусу: ${paidStatusDateEst}` : "Скасовано до дати запису"}>
              🚫
            </span>
          );
        } else if (client.paidServiceAttended === true && showPaidCheck) {
          const isConfirmed = paidAttendanceValue === 2;
          attendanceIcon = (
            <span
              className={`inline-flex items-center justify-center ${attIconCls}`}
              title={paidStatusDateEst !== '-' ? `${isConfirmed ? 'Клієнтка підтвердила запис на платну послугу' : 'Клієнтка прийшла на платну послугу'}. Дата встановлення статусу: ${paidStatusDateEst}` : (isConfirmed ? 'Клієнтка підтвердила запис на платну послугу' : 'Клієнтка прийшла на платну послугу')}
            >
              {isConfirmed ? (
                <ConfirmedCheckIcon size={17} />
              ) : (
                <span className="text-[14px] leading-none">✅</span>
              )}
            </span>
          );
        } else if (client.paidServiceAttended === false && isPast) {
          attendanceIcon = (
            <span className={`text-red-600 ${attIconCls}`} title={paidStatusDateEst !== '-' ? `Клієнтка не з'явилася на платну послугу. Дата встановлення статусу: ${paidStatusDateEst}` : "Клієнтка не з'явилася на платну послугу"}>
              ❌
            </span>
          );
        } else if (isPast) {
          attendanceIcon = (
            <span
              className={`text-gray-500 ${attIconCls}`}
              title={paidStatusDateEst !== '-' ? `Немає підтвердження відвідування платної послуги. Дата встановлення статусу: ${paidStatusDateEst}` : "Немає підтвердження відвідування платної послуги (встановіть attendance в Altegio)"}
            >
              ❓
            </span>
          );
        } else {
          attendanceIcon = (
            <span className={`text-gray-700 ${attIconCls}`} title={paidStatusDateEst !== '-' ? `Присутність: Очікується. Дата встановлення статусу: ${paidStatusDateEst}` : "Присутність: Очікується"}>
              ⏳
            </span>
          );
        }

        // pendingIcon більше не потрібен, бо ⏳ входить в attendanceIcon (сьогодні/майбутнє при null)
        const pendingIcon = null;
        const paidRecordCreatedDate = formatDateDDMMYYHHMM(client.paidServiceRecordCreatedAt);
        const paidRecordCreatedDateDisplay = formatDateDDMMYY(client.paidServiceRecordCreatedAt);
        const baseTitle = isPast ? "Минулий запис на платну послугу" : "Майбутній запис на платну послугу";
        const tooltipTitle = paidRecordCreatedDate !== '-' ? `${baseTitle}\nЗапис створено: ${paidRecordCreatedDate}` : baseTitle;
        // Сума запису (перенесена з колонки Сума)
        const breakdown = client.paidServiceVisitBreakdown as { masterName: string; sumUAH: number }[] | undefined;
        const rawHasBreakdown = Array.isArray(breakdown) && breakdown.length > 0;
        const totalFromBreakdown = rawHasBreakdown ? breakdown!.reduce((acc, b) => acc + b.sumUAH, 0) : 0;
        const ptc = typeof client.paidServiceTotalCost === 'number' ? client.paidServiceTotalCost : null;
        const spent = typeof client.spent === 'number' ? client.spent : 0;
        const breakdownMismatch =
          rawHasBreakdown &&
          ((ptc != null && ptc > 0 && Math.abs(totalFromBreakdown - ptc) > Math.max(1000, ptc * 0.15)) ||
            (spent > 0 && totalFromBreakdown > spent * 2));
        const hasBreakdown = rawHasBreakdown && !breakdownMismatch && totalFromBreakdown > 0;
        const displaySum = hasBreakdown ? totalFromBreakdown : (ptc != null && ptc > 0 ? ptc : null);
        const displayLabel = hasBreakdown ? 'Сума по майстрах' : 'Сума запису';
        
        const paidDotTitle = 'Тригер: змінився запис';
        // Одна крапочка на клієнта: winningKey визначає, де показувати.
        // Якщо є перезапис і winningKey стосується запису — крапочка на іконці перезапису (пріоритет).
        const paidColumnKeys = ['paidServiceDate', 'paidServiceRecordCreatedAt', 'paidServiceTotalCost'];
        const hasRebook = Boolean(client.paidServiceIsRebooking);
        const winningKeyIsPaidColumn = paidColumnKeys.includes(winningKey ?? '');
        const showDotOnPaidRebook = hasRebook && winningKeyIsPaidColumn;
        const showDotOnPaidDate = winningKey === 'paidServiceDate' && !hasRebook;
        const showDotOnPaidRecordCreated = winningKey === 'paidServiceRecordCreatedAt' && !hasRebook;
        const showDotOnPaidTotalCost = Boolean(winningKey === 'paidServiceTotalCost' && displaySum != null && displaySum > 0) && !hasRebook;
        const showPaidAttendanceDotEffective = winningKey === 'paidServiceAttended' || winningKey === 'paidServiceCancelled';
        const showDotOnPaidPending = Boolean(winningKey === 'paidServiceAttended' || winningKey === 'paidServiceCancelled') && !attendanceIcon && pendingIcon;

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
              title={`${tooltipTitle}\nНатисніть, щоб переглянути історію записів`}
              onClick={() => {
                if (!client.altegioClientId) return;
                setRecordHistoryType('paid');
                setRecordHistoryClient(client);
              }}
              disabled={!client.altegioClientId}
            >
              <span className="inline-flex items-center">
                <WithCornerRedDot show={showDotOnPaidDate || showDotOnPaidRecordCreated} title={paidDotTitle} dotClassName="-top-[5px] -right-[4px]">
                  <span className={`rounded-full px-0 py-0.5 ${
                    paidIsToday ? 'bg-green-200' : paidCreatedToday ? 'bg-gray-200' : ''
                  }`}>{dateStr}</span>
                </WithCornerRedDot>
                  </span>
                </button>
                {pendingIcon ? (
              <WithCornerRedDot show={showDotOnPaidPending} title={paidDotTitle} dotClassName="-top-[5px] -right-[4px]">
                {pendingIcon}
              </WithCornerRedDot>
            ) : null}{client.paidServiceIsRebooking ? (
              <WithCornerRedDot show={showDotOnPaidRebook} title={paidDotTitle} dotClassName="-top-[5px] -right-[4px]">
                <span
                  className="text-purple-700 text-[14px] leading-none"
                  title={`Перезапис 🔁\nСтворено в день: ${client.paidServiceRebookFromKyivDay || '-'}\nАтрибутовано: ${shortPersonName(client.paidServiceRebookFromMasterName) || '-'}`}
                >
                  🔁
                </span>
              </WithCornerRedDot>
            ) : null}{attendanceIcon ? (
              <WithCornerRedDot show={showPaidAttendanceDotEffective} title={paidDotTitle} dotClassName="-top-[5px] -right-[4px]">
                {attendanceIcon}
              </WithCornerRedDot>
            ) : null}
            </span>

            {paidRecordCreatedDateDisplay !== '-' || (!hideFinances && displaySum != null && displaySum > 0) ? (
              <span
                className="text-[10px] leading-none opacity-60 max-w-[220px] sm:max-w-[320px] truncate text-left inline-flex items-center gap-0.5 flex-wrap"
                title={paidRecordCreatedDate !== '-' ? `Запис створено: ${paidRecordCreatedDate}${!hideFinances && displaySum != null && displaySum > 0 ? ` · ${displayLabel}: ${formatUAHExact(displaySum)}` : ''}` : (!hideFinances && displaySum != null && displaySum > 0 ? `${displayLabel}: ${formatUAHExact(displaySum)}` : '')}
              >
                {paidRecordCreatedDateDisplay !== '-' ? paidRecordCreatedDateDisplay : ''}
                {paidRecordCreatedDateDisplay !== '-' && !hideFinances && displaySum != null && displaySum > 0 ? ', ' : ''}
                {!hideFinances && displaySum != null && displaySum > 0 ? (
                  <span className="relative inline-flex items-center">
                    {formatUAHThousands(displaySum)}
                    {showDotOnPaidTotalCost ? (
                      <span className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle" title="Тригер: змінилась вартість платної послуги" />
                    ) : null}
                  </span>
                ) : ''}
              </span>
            ) : null}
          </span>
        );
      })()
    ) : (client as any).paidServiceDeletedInAltegio ? (
      <span className="text-gray-500 italic" title="Візит/запис видалено в Altegio (404), платний блок очищено">
        Видалено в Altegio
      </span>
    ) : (
      ""
    )}
      </td>
    );
  })()}
  <td className="pl-0 pr-1 sm:pr-1.5 py-1 text-xs whitespace-nowrap text-left" style={cellPx("master", getColumnStyle(columnWidths.master, true))}>
    {(() => {
      // Колонка "Майстер":
      // - Якщо є платний запис — показуємо майстра з Altegio (serviceMasterName)
      // - Якщо serviceMasterName відсутній — показуємо відповідального (masterId) як fallback,
      //   щоб тригер masterId мав “місце в UI” для крапочки.
      const full = (client.serviceMasterName || '').trim();
      const breakdown = client.paidServiceVisitBreakdown as { masterName: string; sumUAH: number }[] | undefined;
      const totalFromBreakdownM = Array.isArray(breakdown) && breakdown.length > 0 ? breakdown!.reduce((a, b) => a + b.sumUAH, 0) : 0;
      const ptcM = typeof client.paidServiceTotalCost === 'number' ? client.paidServiceTotalCost : null;
      const spentM = typeof client.spent === 'number' ? client.spent : 0;
      const breakdownMismatchM =
        Array.isArray(breakdown) &&
        breakdown!.length > 0 &&
        ((ptcM != null && ptcM > 0 && Math.abs(totalFromBreakdownM - ptcM) > Math.max(1000, ptcM * 0.15)) ||
          (spentM > 0 && totalFromBreakdownM > spentM * 2));
      // Показуємо breakdown тільки якщо він узгоджений з paidServiceTotalCost (інакше API міг повернути items з усіх записів візиту)
      const hasBreakdown = Array.isArray(breakdown) && breakdown.length > 0 && client.paidServiceDate && !breakdownMismatchM;
      // Першим ставимо майстра з breakdown, чиє ім'я збігається з майстром консультації (хто продав)
      const consultationPrimary = (client.consultationMasterName || '').trim() ? firstToken((client.consultationMasterName || '').toString().trim()).toLowerCase() : '';
      const orderPrimary = full ? firstToken(full).toLowerCase() : '';
      const paidMasterName = shortPersonName(full) || (hasBreakdown ? shortPersonName(breakdown![0].masterName) : '');
      const responsibleRaw =
        client.masterId ? (masters.find((m) => m.id === client.masterId)?.name || '') : '';
      const responsibleName = shortPersonName(responsibleRaw);

      const showPaidMaster = Boolean(client.paidServiceDate && paidMasterName);
      const showResponsibleMaster = Boolean(!showPaidMaster && responsibleName);

      if (!showPaidMaster && !showResponsibleMaster) return '';

      const shouldHighlightMaster = false;
      const highlightClass = '';

      const secondaryFull = ((client as any).serviceSecondaryMasterName || '').trim();
      const secondary = shortPersonName(secondaryFull);

      const name = showPaidMaster ? paidMasterName : responsibleName;
      let displayText: ReactNode = name;
      if (hasBreakdown) {
        // Упорядковуємо: першим — майстер з breakdown, чиє ім'я збігається з consultationMasterName; решта — за іменем
        const sorted = [...breakdown!].sort((a, b) => {
          const aFirst = firstToken(a.masterName).toLowerCase();
          const bFirst = firstToken(b.masterName).toLowerCase();
          if (consultationPrimary && aFirst === consultationPrimary) return -1;
          if (consultationPrimary && bFirst === consultationPrimary) return 1;
          return aFirst.localeCompare(bFirst);
        });
        // Майстрів у стовпчик; суми не показуємо (без дужок)
        displayText = (
          <>
            {sorted.map((b, index) => {
              const isFirst = index === 0;
              const rowClass = isFirst && shouldHighlightMaster ? 'rounded-full px-2 py-0.5 bg-[#EAB308] text-gray-900' : '';
              return (
                <span key={`${b.masterName}-${b.sumUAH}`} className={rowClass ? `block text-left ${rowClass}` : 'block text-left'}>
                  {shortPersonName(b.masterName)}
                </span>
              );
            })}
          </>
        );
      } else if (showPaidMaster && secondary && secondary.toLowerCase().trim() !== name.toLowerCase().trim()) {
        displayText = (
          <>
            <span>{name}</span>
            <span className="text-[10px] leading-none opacity-70 ml-0.5"> · {secondary}</span>
          </>
        );
      }
      let historyTitle = name;
      try {
        const raw = client.serviceMasterHistory ? JSON.parse(client.serviceMasterHistory) : null;
        if (Array.isArray(raw) && raw.length) {
          const last5 = raw.slice(-5);
          historyTitle =
            `${name}\n\nІсторія змін (останні 5):\n` +
            last5
              .map((h: any) => `${h.kyivDay || '-'} — ${shortPersonName(h.masterName) || '-'}`)
              .join('\n');
        }
      } catch {
        // ignore
      }

      return (
        <span className="flex flex-col items-start leading-none">
          {showPaidMaster ? (
            <button
              type="button"
              className="hover:underline text-left"
              title={`${historyTitle}\n\nНатисніть, щоб відкрити повну історію`}
              onClick={() => setMasterHistoryClient(client)}
            >
              <span className={`flex ${hasBreakdown ? 'flex-col items-start gap-0.5' : 'inline-flex items-center flex-wrap gap-x-1'} ${!hasBreakdown ? highlightClass : ''}`}>
                {hasBreakdown ? displayText : <span>{displayText}</span>}
                {showMasterDot ? (
                  <span
                    className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle translate-y-[1px]"
                    title="Тригер: змінився майстер"
                  />
                ) : null}
              </span>
            </button>
          ) : (
            <span className="text-left" title={`Відповідальний: ${name}`}>
              <span className={`inline-flex items-center ${highlightClass}`}>
                <span>{name}</span>
                {showMasterDot ? (
                  <span
                    className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle translate-y-[1px]"
                    title="Тригер: змінився майстер"
                  />
                ) : null}
              </span>
            </span>
          )}
        </span>
      );
    })()}
  </td>
  <td className="pl-0 pr-1 sm:pr-1.5 py-1 text-xs whitespace-nowrap text-left" style={cellPx("phone", getColumnStyle(columnWidths.phone, true))}>
    {client.phone ? (
      (() => {
        const digits = (client.phone || "").replace(/\D/g, "");
        const tel = digits.startsWith("380") && digits.length >= 12
          ? `+${digits.slice(0, 12)}`
          : digits.startsWith("0") && digits.length >= 9
            ? `+38${digits}`
            : digits.length >= 10
              ? `+${digits}`
              : null;
        return tel ? (
          <a href={`tel:${tel}`} className="link link-hover font-mono">
            {client.phone}
          </a>
        ) : (
          <span className="font-mono">{client.phone}</span>
        );
      })()
    ) : (
      <span className="text-gray-400">—</span>
    )}
  </td>
  {!hideActionsColumn && (
    <td className="pl-0 pr-1 sm:pr-1.5 py-1 text-xs text-left" style={cellPx("actions", getColumnStyle(columnWidths.actions, true))}>
      <div className="flex justify-start gap-1">
        <button
          className="btn btn-xs btn-ghost"
          onClick={() => setEditingClient(client)}
          title="Редагувати"
        >
          ✏️
        </button>
      </div>
    </td>
  )}
  </tr>
);
}

function directClientTableRowPropsAreEqual(
  prev: DirectClientTableRowProps,
  next: DirectClientTableRowProps
): boolean {
  if (prev.index !== next.index) return false;
  if (prev.client !== next.client) return false;
  if (prev.measureElement !== next.measureElement) return false;
  const pv = prev.virtualRow;
  const nv = next.virtualRow;
  if (pv === nv) return true;
  if (pv == null || nv == null) return pv === nv;
  return (
    pv.index === nv.index &&
    pv.start === nv.start &&
    pv.end === nv.end &&
    pv.size === nv.size &&
    pv.key === nv.key &&
    pv.lane === nv.lane
  );
}

export const DirectClientTableRow = memo(DirectClientTableRowInner, directClientTableRowPropsAreEqual);
