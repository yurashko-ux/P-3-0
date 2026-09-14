"use client";

import Link from "next/link";
import { useState, type SyntheticEvent } from "react";
import { hasNormalInstagramUsername } from "@/lib/altegio/client-utils";
import { AvatarSlot } from "../../_components/DirectClientTableAvatar";
import {
  BinotelLeadBadgeIcon,
  ClientBadgeIcon,
  LeadBadgeIcon,
  SpendCircleBadge,
  SpendMegaBadge,
  SpendStarBadge,
} from "../../_components/DirectClientTableRowBadges";
import { buildAltegioClientsSearchUrl } from "../../_components/direct-client-table-activity";
import { getFullName } from "../../_components/direct-client-table-formatters";
import type { InactiveBaseClientRow } from "./InactiveBaseChatCell";

function SpendTypeBadge({
  spent,
  isClientType,
  isBinotelLead,
}: {
  spent: number | null | undefined;
  isClientType: boolean;
  isBinotelLead: boolean;
}) {
  if (!isClientType) {
    return isBinotelLead ? <BinotelLeadBadgeIcon /> : <LeadBadgeIcon />;
  }

  const spendValue = (() => {
    const num = typeof spent === "number" ? spent : Number(spent);
    return Number.isFinite(num) ? num : 0;
  })();

  const spendShowMega = spendValue > 1_000_000;
  const spendShowStar = spendValue >= 100_000;
  const spendShowCircleTen = spendValue >= 20_000 && spendValue < 100_000;
  const spendShowCircleOne = spendValue >= 10_000 && spendValue < 20_000;
  const spendShowCircleEmpty = spendValue < 10_000;
  const spendCircleRaw = Math.floor(spendValue / 10_000);
  const spendCircleNumber = Math.min(9, Math.max(2, spendCircleRaw));
  const spendStarRaw = Math.floor(spendValue / 100_000);
  const spendStarNumber = Math.min(9, Math.max(1, spendStarRaw));
  const spendShowStarNumber = spendValue > 200_000;

  if (spendShowMega) return <SpendMegaBadge />;
  if (spendShowStar) {
    return (
      <SpendStarBadge
        size={spendShowStarNumber ? 22 : 18}
        number={spendShowStarNumber ? spendStarNumber : undefined}
        fontSize={spendShowStarNumber ? 8 : 12}
      />
    );
  }
  if (spendShowCircleTen) return <SpendCircleBadge number={spendCircleNumber} />;
  if (spendShowCircleOne) return <SpendCircleBadge number={1} />;
  if (spendShowCircleEmpty) return <SpendCircleBadge />;
  return <ClientBadgeIcon />;
}

type Props = {
  client: InactiveBaseClientRow;
  /** Посилання на Direct (нове вікно). */
  directHref: string;
};

/** ПІБ як у Direct: фото + зірка/крапка за spent + імʼя + (visits). */
export function InactiveBaseNameCell({ client, directHref }: Props) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState<{ src: string; username: string } | null>(null);

  const fullName = getFullName(client as Parameters<typeof getFullName>[0]);
  const username = (client.instagramUsername || "").trim();
  const isNormalInstagram = hasNormalInstagramUsername(username);
  const isClientType = client.altegioClientId != null && Number(client.altegioClientId) > 0;
  const isBinotelLead = username.toLowerCase().startsWith("binotel_");
  const visitsValue =
    client.visits !== null && client.visits !== undefined ? Number(client.visits) : null;
  const visitsSuffix =
    visitsValue !== null && Number.isFinite(visitsValue) ? `(${visitsValue})` : "";

  const avatarSrc =
    isNormalInstagram && !avatarFailed
      ? `/api/admin/direct/instagram-avatar?username=${encodeURIComponent(username)}`
      : null;

  const phoneQuery = (client.phone || "").toString().trim();
  const altegioSearchQuery = isClientType
    ? phoneQuery || fullName || (isNormalInstagram ? username : "")
    : fullName || (isNormalInstagram ? username : "");
  const altegioUrl = buildAltegioClientsSearchUrl(altegioSearchQuery);

  const onAvatarError = (e: SyntheticEvent<HTMLImageElement>) => {
    (e.currentTarget as HTMLImageElement).style.display = "none";
    setAvatarFailed(true);
  };

  return (
    <>
      <div className="flex items-center gap-1.5 min-w-0">
        <AvatarSlot
          size="xs"
          avatarSrc={avatarSrc}
          onError={onAvatarError}
          onClick={
            avatarSrc
              ? () => setFullscreen({ src: avatarSrc, username: username || fullName })
              : undefined
          }
        />
        {isClientType ? (
          <a
            href={altegioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 hover:opacity-80 transition-opacity"
            title={`Altegio ID: ${client.altegioClientId}`}
            aria-label="Відкрити в Altegio"
            onClick={(e) => e.stopPropagation()}
          >
            <SpendTypeBadge spent={client.spent} isClientType isBinotelLead={false} />
          </a>
        ) : (
          <span className="shrink-0" title="Лід (без Altegio ID)">
            <SpendTypeBadge spent={client.spent} isClientType={false} isBinotelLead={isBinotelLead} />
          </span>
        )}
        <Link
          href={directHref}
          target="_blank"
          rel="noopener noreferrer"
          className="link link-hover min-w-0 flex items-baseline gap-0.5"
          onClick={(e) => e.stopPropagation()}
          title={fullName}
        >
          <span className="truncate">{fullName}</span>
          {visitsSuffix ? (
            <span className="shrink-0 opacity-80">{` ${visitsSuffix}`}</span>
          ) : null}
        </Link>
      </div>
      {fullscreen ? (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setFullscreen(null)}
          role="presentation"
        >
          <img
            src={fullscreen.src}
            alt={fullscreen.username}
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
