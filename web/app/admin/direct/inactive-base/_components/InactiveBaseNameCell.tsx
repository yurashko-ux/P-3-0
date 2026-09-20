"use client";

import Link from "next/link";
import { useState, type SyntheticEvent } from "react";
import { hasNormalInstagramUsername } from "@/lib/altegio/client-utils";
import { AvatarSlot } from "../../_components/DirectClientTableAvatar";
import {
  BinotelLeadBadgeIcon,
  LeadBadgeIcon,
} from "../../_components/DirectClientTableRowBadges";
import { ClientSpendLoyaltyBadge } from "@/app/admin/_components/ClientNameWithLoyalty";
import { buildAltegioClientsSearchUrl } from "../../_components/direct-client-table-activity";
import { getFullName } from "../../_components/direct-client-table-formatters";
import type { InactiveBaseClientRow } from "./InactiveBaseChatCell";

type Props = {
  client: InactiveBaseClientRow;
  /** Посилання на Direct (нове вікно). */
  directHref: string;
};

/** ПІБ як у Direct: фото + зірка/кружечок за spent + імʼя + (visits). */
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

  const typeBadge = isClientType ? (
    <a
      href={altegioUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 hover:opacity-80 transition-opacity"
      title={`Altegio ID: ${client.altegioClientId}`}
      aria-label="Відкрити в Altegio"
      onClick={(e) => e.stopPropagation()}
    >
      <ClientSpendLoyaltyBadge spent={client.spent} size="md" />
    </a>
  ) : (
    <span className="shrink-0" title="Лід (без Altegio ID)">
      {isBinotelLead ? <BinotelLeadBadgeIcon /> : <LeadBadgeIcon />}
    </span>
  );

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
        {typeBadge}
        <Link
          href={directHref}
          target="_blank"
          rel="noopener noreferrer"
          className="link link-hover min-w-0 flex items-baseline gap-0.5"
          onClick={(e) => e.stopPropagation()}
          title={fullName}
        >
          <span className="truncate">{fullName}</span>
          {visitsValue !== null && Number.isFinite(visitsValue) ? (
            <span className="shrink-0 opacity-80">{` (${visitsValue})`}</span>
          ) : null}
        </Link>
      </div>
      {fullscreen ? (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setFullscreen(null)}
          role="presentation"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fullscreen.src}
            alt={fullscreen.username}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
