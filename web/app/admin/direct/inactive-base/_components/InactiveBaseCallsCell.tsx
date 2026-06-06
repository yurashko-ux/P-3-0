"use client";

import type { DirectClient } from "@/lib/direct-types";
import { formatDateDDMMYY, formatDateDDMMYYHHMM } from "../../_components/direct-client-table-formatters";
import { BinotelCallTypeIcon } from "../../_components/BinotelCallTypeIcon";
import { PlayRecordingButton } from "../../_components/PlayRecordingButton";
import { InactiveBaseCounterHoverTip } from "./InactiveBaseCounterHoverTip";
import type { InactiveBaseClientRow } from "./InactiveBaseChatCell";

const PILL_BASE =
  "relative inline-flex items-center justify-center rounded-full px-1.5 py-0.5 tabular-nums text-[11px] font-normal leading-none min-w-[1.25rem]";

function groupCallsPillClass(count: number): string {
  return count === 0
    ? `${PILL_BASE} bg-gray-200 text-gray-900 cursor-default`
    : `${PILL_BASE} bg-[#2AABEE] text-white cursor-default`;
}

type Props = {
  client: InactiveBaseClientRow;
  /** Згорнута група — сума всіх дзвінків учасників. */
  groupCallsTotal?: number | null;
  canListenCalls?: boolean;
  onOpenHistory: (client: DirectClient) => void;
  onPlayRequest: (url: string) => void;
};

function toDirectClient(client: InactiveBaseClientRow): DirectClient {
  return {
    id: client.id,
    instagramUsername: client.instagramUsername,
    firstName: client.firstName,
    lastName: client.lastName,
    phone: client.phone,
    callStatusId: client.callStatusId ?? null,
  } as DirectClient;
}

/** Колонка «Дзвінки» — як у Direct: іконка, ▶ запис, дата; у згорнутій групі — сума дзвінків. */
export function InactiveBaseCallsCell({
  client,
  groupCallsTotal = null,
  canListenCalls = true,
  onOpenHistory,
  onPlayRequest,
}: Props) {
  const isGroupSummary = groupCallsTotal != null;

  if (isGroupSummary) {
    const count = groupCallsTotal;
    const tipText = `Всього дзвінків у групі: ${count}`;
    return (
      <InactiveBaseCounterHoverTip text={tipText}>
        <span className={groupCallsPillClass(count)} aria-label={tipText}>
          {count}
        </span>
      </InactiveBaseCounterHoverTip>
    );
  }

  const count = client.binotelCallsCount ?? 0;
  if (count <= 0) return null;

  const disposition = client.binotelLatestCallDisposition || "";
  const isSuccess = ["ANSWER", "VM-SUCCESS", "SUCCESS"].includes(disposition);
  const hasRecording = client.binotelLatestCallRecordingUrl || client.binotelLatestCallGeneralID;
  const startTime = client.binotelLatestCallStartTime;
  const dateStr = formatDateDDMMYY(startTime);

  return (
    <span
      className="inline-flex flex-col items-start gap-0.5"
      title={formatDateDDMMYYHHMM(startTime)}
    >
      <span className="inline-flex items-center justify-start gap-1">
        <button
          type="button"
          onClick={() => onOpenHistory(toDirectClient(client))}
          className="inline-flex items-center"
          title={`Історія дзвінків Binotel. Останній: ${formatDateDDMMYYHHMM(startTime)}`}
        >
          <BinotelCallTypeIcon
            callType={client.binotelLatestCallType || "incoming"}
            success={isSuccess}
            size={18}
          />
        </button>
        {hasRecording && isSuccess ? (
          <PlayRecordingButton
            recordingUrl={client.binotelLatestCallRecordingUrl}
            generalCallID={client.binotelLatestCallGeneralID}
            title="Прослухати останній запис"
            onPlayRequest={onPlayRequest}
            listenDisabled={!canListenCalls}
          />
        ) : null}
      </span>
      {dateStr !== "-" ? (
        <span className="text-[10px] leading-none opacity-60" title={formatDateDDMMYYHHMM(startTime)}>
          {dateStr}
        </span>
      ) : null}
    </span>
  );
}
