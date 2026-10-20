"use client";

import { useState, type SyntheticEvent } from "react";
import type { DirectClient } from "@/lib/direct-types";
import { hasNormalInstagramUsername } from "@/lib/altegio/client-utils";
import { AvatarSlot } from "./DirectClientTableAvatar";
import {
  BinotelLeadBadgeIcon,
  ClientBadgeIcon,
  LeadBadgeIcon,
  SpendCircleBadge,
  SpendMegaBadge,
  SpendStarBadge,
} from "./DirectClientTableRowBadges";
import { buildAltegioClientsSearchUrl } from "./direct-client-table-activity";
import { getFullName } from "./direct-client-table-formatters";

type Props = {
  client: Pick<
    DirectClient,
    | "id"
    | "instagramUsername"
    | "firstName"
    | "lastName"
    | "phone"
    | "spent"
    | "visits"
    | "altegioClientId"
  >;
};

/** Фото + зірка/кружечок + імʼя + (візити) — ті самі розміри й відступи, що в колонці імені Direct. */
export function DirectClientIdentityCell({ client }: Props) {
  const [fullscreen, setFullscreen] = useState<{ src: string; username: string } | null>(null);

  const first = (client.firstName || "").toString().trim();
  const last = (client.lastName || "").toString().trim();
  const hasName = Boolean(first || last);
  const fullName = getFullName(client as DirectClient);
  const username = (client.instagramUsername || "").toString();
  const isNoInstagram = username === "NO INSTAGRAM" || username.startsWith("no_instagram_");
  const isMissingInstagram = username.startsWith("missing_instagram_");
  const isNormalInstagram = hasNormalInstagramUsername(username);
  const invalidIgLabel = isNoInstagram ? "NO" : isMissingInstagram ? "missing" : null;
  const isClientType = Boolean(client.altegioClientId);

  const spendValue = (() => {
    const spendRaw = (client.spent ?? 0) as unknown;
    if (typeof spendRaw === "string") {
      const num = Number(String(spendRaw).replace(/\s+/g, ""));
      return Number.isFinite(num) ? num : 0;
    }
    const num = Number(spendRaw);
    return Number.isFinite(num) ? num : 0;
  })();
  const spendShowMega = spendValue > 1000000;
  const spendShowStar = spendValue >= 100000;
  const spendShowCircleTen = spendValue >= 20000 && spendValue < 100000;
  const spendShowCircleOne = spendValue >= 10000 && spendValue < 20000;
  const spendShowCircleEmpty = spendValue < 10000;
  const spendCircleNumber = Math.min(9, Math.max(2, Math.floor(spendValue / 10000)));
  const spendStarNumber = Math.min(9, Math.max(1, Math.floor(spendValue / 100000)));
  const spendShowStarNumber = spendValue > 200000;

  const visitsValue = client.visits !== null && client.visits !== undefined ? client.visits : null;
  const visitsSuffix = visitsValue !== null ? `(${visitsValue})` : "";
  const nameOneLine = hasName ? [first, last].filter(Boolean).join(" ").trim() || fullName : "";
  const phoneQuery = (client.phone || "").toString().trim();
  const fallbackNameQuery = ((hasName ? nameOneLine : fullName) || "").toString().trim();
  const fallbackIgQuery = isNormalInstagram ? username : "";
  const altegioSearchQuery = isClientType
    ? phoneQuery || (fallbackNameQuery !== "-" ? fallbackNameQuery : "") || fallbackIgQuery
    : (fallbackNameQuery !== "-" ? fallbackNameQuery : "") || fallbackIgQuery;
  const altegioUrl = buildAltegioClientsSearchUrl(altegioSearchQuery);
  const typeBadgeTitle = isClientType
    ? `Altegio ID: ${client.altegioClientId}\nВідкрити в Altegio (Клієнтська база)`
    : "Лід (ще без Altegio ID)";

  const params = new URLSearchParams();
  params.set("clientId", client.id);
  if (isNormalInstagram) params.set("username", username);
  const avatarSrc = `/api/admin/direct/instagram-avatar?${params.toString()}`;

  const onAvatarError = (e: SyntheticEvent<HTMLImageElement>) => {
    (e.currentTarget as HTMLImageElement).style.display = "none";
  };

  const spendBadge = spendShowMega ? (
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
  );

  const typeBadge = isClientType ? (
    <a
      href={altegioUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 hover:opacity-80 transition-opacity"
      title={typeBadgeTitle}
      aria-label={typeBadgeTitle}
      onClick={(e) => e.stopPropagation()}
    >
      {spendBadge}
    </a>
  ) : (
    <span className="shrink-0" title="Лід (ще без Altegio ID)">
      {username.startsWith("binotel_") ? <BinotelLeadBadgeIcon /> : <LeadBadgeIcon />}
    </span>
  );

  const label = hasName ? nameOneLine : isNormalInstagram ? username : "—";

  return (
    <>
      <div className="flex items-center gap-1 min-w-0 max-w-full">
        <AvatarSlot
          avatarSrc={avatarSrc}
          onError={onAvatarError}
          onClick={() =>
            setFullscreen({ src: avatarSrc, username: isNormalInstagram ? username : client.id })
          }
        />
        {typeBadge}
        {isNormalInstagram ? (
          <a
            href={`https://instagram.com/${username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="link link-primary flex items-center gap-1 min-w-0 max-w-full"
            title={hasName ? `${nameOneLine} - https://instagram.com/${username}` : `https://instagram.com/${username}`}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="min-w-0 truncate" title={label}>
              {label}
            </span>
            {visitsSuffix ? <span className="shrink-0 opacity-80">{` ${visitsSuffix}`}</span> : null}
          </a>
        ) : (
          <span className="flex items-center gap-1 min-w-0 max-w-full" title={label}>
            <span className="min-w-0 truncate">{label}</span>
            {visitsSuffix ? <span className="shrink-0 opacity-80">{` ${visitsSuffix}`}</span> : null}
          </span>
        )}
      </div>
      {invalidIgLabel ? (
        <span className="mt-0.5 text-[10px] text-red-600 font-semibold leading-none">{invalidIgLabel}</span>
      ) : null}
      {fullscreen ? (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setFullscreen(null)}
          role="presentation"
        >
          <img
            src={fullscreen.src}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
