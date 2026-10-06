// Instagram-посилання нових лідів для Telegram-звітів.

import { hasNormalInstagramUsername } from "@/lib/altegio/client-utils";
import { toKyivDay } from "@/lib/direct-stats-config";
import { normalizeInstagram } from "@/lib/normalize";

export type LeadInstagramLink = {
  username: string;
  /** null — немає реального Instagram, у тексті без посилання. */
  href: string | null;
};

const TELEGRAM_MESSAGE_LIMIT = 3900;

export function leadInstagramLink(client: {
  id: string;
  instagramUsername?: string | null;
  firstContactDate?: string | null;
}): LeadInstagramLink & { sortKey: string } {
  const normalized = normalizeInstagram(client.instagramUsername);
  const raw = String(client.instagramUsername || "").replace(/^@+/, "").trim();
  const username = normalized || raw || "без Instagram";
  const href =
    normalized && hasNormalInstagramUsername(normalized)
      ? `https://instagram.com/${encodeURIComponent(normalized)}`
      : null;
  const sortKey = `${toKyivDay(client.firstContactDate) || ""}\t${username}\t${client.id}`;
  return { username, href, sortKey };
}

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Рядок звіту: @username як посилання на профіль Instagram. */
export function formatLeadInstagramTelegramLine(lead: LeadInstagramLink): string {
  if (!lead.href) return escapeTelegramHtml(lead.username);
  const label = escapeTelegramHtml(`@${lead.username.replace(/^@+/, "")}`);
  return `<a href="${escapeTelegramHtml(lead.href)}">${label}</a>`;
}

/** Ділить HTML-текст по рядках, щоб кожен шматок вмістився в ліміт Telegram. */
export function splitTelegramHtml(text: string): string[] {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) return [text];
  const lines = text.split("\n");
  const chunks: string[] = [];
  let buf = "";
  for (const line of lines) {
    const candidate = buf ? `${buf}\n${line}` : line;
    if (candidate.length > TELEGRAM_MESSAGE_LIMIT && buf) {
      chunks.push(buf);
      buf = line;
    } else {
      buf = candidate;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length > 0 ? chunks : [text];
}
