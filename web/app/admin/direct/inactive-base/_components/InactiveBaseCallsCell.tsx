"use client";

import type { DirectClient } from "@/lib/direct-types";
import { formatDateDDMMYY, formatDateDDMMYYHHMM } from "../../_components/direct-client-table-formatters";
import { BinotelCallTypeIcon } from "../../_components/BinotelCallTypeIcon";
import { PlayRecordingButton } from "../../_components/PlayRecordingButton";
import type { InactiveBaseClientRow } from "./InactiveBaseChatCell";

type Props = {
  client: InactiveBaseClientRow;
  hidden?: boolean;
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

/** Колонка «Дзвінки» — як у Direct: іконка, ▶ запис, дата. */
export function InactiveBaseCallsCell({
  client,
  hidden,
  canListenCalls = true,
  onOpenHistory,
  onPlayRequest,
}: Props) {
  if (hidden) return <span className="text-base-content/40">—</span>;

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
