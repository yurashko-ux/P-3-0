"use client";

import type { DirectClient } from "@/lib/direct-types";
import { getDisplayedState, type DisplayedStateId } from "@/lib/direct-displayed-state";
import { getRecordMasterDisplay } from "@/lib/direct-master-column-display";
import { ConfirmedCheckIcon } from "../../_components/CheckIcon";
import { effectiveAltegioAttendanceDisplay } from "../../_components/direct-attendance-display";
import {
  formatDateDDMMYY,
  formatDateDDMMYYHHMM,
  formatDateShortYear,
} from "../../_components/direct-client-table-formatters";
import { StateIcon } from "../../_components/StateIcon";
import type { InactiveBaseClientRow } from "./InactiveBaseChatCell";

const STATE_GLYPH: Partial<Record<DisplayedStateId, string>> = {
  sold: "🔥",
  "paid-past": "⚠️",
  rebook: "🔁",
  waiting: "⏳",
  "broken-heart": "💔",
};

function kyivDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function todayKyiv(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Колонка «Стан» — той самий значок, що в Direct (getDisplayedState), плюс дата створення запису. */
export function ActiveBaseStateCell({ client }: { client: InactiveBaseClientRow }) {
  const displayed = getDisplayedState(client as DirectClient);
  if (!displayed || displayed === "restored") return null;
  const glyph = STATE_GLYPH[displayed];
  const date = formatDateDDMMYY(client.paidServiceRecordCreatedAt);
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="inline-flex items-center justify-center" title={displayed}>
        {glyph ? (
          <span className="text-[20px] leading-none inline-flex items-center justify-center">{glyph}</span>
        ) : (
          <StateIcon state={displayed} size={28} />
        )}
      </span>
      {date !== "-" ? <span className="text-[10px] leading-none opacity-60">{date}</span> : null}
    </div>
  );
}

export function ActiveBaseRecordCell({ client }: { client: InactiveBaseClientRow }) {
  const today = todayKyiv();
  if (client.paidServiceDeletedInAltegio) {
    return <span className="text-gray-500 italic">Видалено в Altegio</span>;
  }
  if (!client.signedUpForPaidService || !client.paidServiceDate) return null;
  const paidKyivDay = kyivDay(client.paidServiceDate);
  const isPast = paidKyivDay < today;
  const isToday = paidKyivDay === today;
  const createdDay = kyivDay(client.paidServiceRecordCreatedAt);
  const paidStatusDateEst = formatDateDDMMYYHHMM(
    client.paidServiceAttendanceSetAt ?? client.paidServiceRecordCreatedAt
  );
  const paidAttendanceEffective = effectiveAltegioAttendanceDisplay(
    client.paidServiceAttendanceValue,
    client.paidServiceAttended,
    paidKyivDay,
    today,
    { pastMissingMeansConfirmed: true }
  );
  const showPaidCheck = paidAttendanceEffective === 2 ? true : isPast || isToday;
  let attendanceIcon = null;
  if (client.paidServiceCancelled) {
    attendanceIcon = (
      <span className="text-orange-600 text-[14px] leading-none" title="Скасовано до дати запису">
        🚫
      </span>
    );
  } else if (client.paidServiceAttended === true && showPaidCheck) {
    attendanceIcon =
      paidAttendanceEffective === 2 ? (
        <ConfirmedCheckIcon size={17} />
      ) : (
        <span className="text-[14px] leading-none">✅</span>
      );
  } else if (client.paidServiceAttended === false && isPast) {
    attendanceIcon = (
      <span className="text-red-600 text-[14px] leading-none" title="Клієнтка не з'явилася на платну послугу">
        ❌
      </span>
    );
  } else if (isPast) {
    attendanceIcon = (
      <span className="text-gray-500 text-[14px] leading-none" title="Немає підтвердження відвідування">
        ❓
      </span>
    );
  } else {
    attendanceIcon = (
      <span className="text-gray-700 text-[14px] leading-none" title="Присутність: очікується">
        ⏳
      </span>
    );
  }
  const dateClass = isToday
    ? "text-green-600 font-medium"
    : isPast
      ? "text-amber-600 font-medium"
      : "text-blue-600 font-medium";
  const pill = isToday ? "bg-green-200" : createdDay === today ? "bg-gray-200" : "";
  const createdDisplay = formatDateDDMMYY(client.paidServiceRecordCreatedAt);
  const statusHint = paidStatusDateEst !== "-" ? paidStatusDateEst : "";
  return (
    <span className="flex flex-col items-start gap-0.5" title={statusHint || undefined}>
      <span className="flex items-center gap-[1ch]">
        <span className={`rounded-full px-0 py-0.5 ${pill} ${dateClass}`}>
          {formatDateShortYear(client.paidServiceDate)}
        </span>
        {client.paidServiceIsRebooking ? (
          <span className="text-purple-700 text-[14px] leading-none" title="Перезапис">
            🔁
          </span>
        ) : null}
        {attendanceIcon}
      </span>
      {createdDisplay !== "-" ? (
        <span className="text-[10px] leading-none opacity-60">{createdDisplay}</span>
      ) : null}
    </span>
  );
}

export function ActiveBaseRecordMasterCell({ client }: { client: InactiveBaseClientRow }) {
  const recordMaster = getRecordMasterDisplay(client as DirectClient);
  if (!recordMaster.hasContent) return null;
  if (recordMaster.hasBreakdown) {
    return (
      <span className="flex flex-col items-start leading-none">
        {recordMaster.displayLines.map((line) => (
          <span key={line} className="block text-left">
            {line}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center flex-wrap gap-x-1" title={recordMaster.historyTitle}>
      <span>{recordMaster.primaryName}</span>
      {recordMaster.secondaryName ? (
        <span className="text-[10px] leading-none opacity-70">· {recordMaster.secondaryName}</span>
      ) : null}
    </span>
  );
}

export function ActiveBasePhoneCell({ phone }: { phone: string | null | undefined }) {
  if (!phone) return <span className="text-gray-400">—</span>;
  const digits = phone.replace(/\D/g, "");
  const tel =
    digits.startsWith("380") && digits.length >= 12
      ? `+${digits.slice(0, 12)}`
      : digits.startsWith("0") && digits.length >= 9
        ? `+38${digits}`
        : digits.length >= 10
          ? `+${digits}`
          : null;
  return tel ? (
    <a href={`tel:${tel}`} className="link link-hover font-mono">
      {phone}
    </a>
  ) : (
    <span className="font-mono">{phone}</span>
  );
}
