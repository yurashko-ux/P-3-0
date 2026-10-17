// Голосове, фото і відео з Instagram Direct. Посилання Meta живе недовго, тому файл забираємо одразу.
// У логи не пишемо саме посилання: у ньому буває підпис CDN.

import { prisma } from "@/lib/prisma";
import { graphCall, graphCallFailed, sanitizeMeta } from "@/lib/instagram-webhook";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 4;

export const MEDIA_TOO_BIG_LABEL = "Файл більший ніж 25 МБ";

export type IncomingMedia = { type: string; url: string };
export type StoredMedia = { id: string; kind: string; mime: string; byteSize: number };

export function mediaLabel(kind: string): string {
  if (kind === "audio") return "🎤 голосове";
  if (kind === "image") return "📷 фото";
  if (kind === "video") return "🎬 відео";
  return "📎 файл";
}

export function mediaKind(type: string, mime: string): string {
  const kind = type.trim().toLowerCase();
  const content = mime.trim().toLowerCase();
  if (kind === "audio" || kind === "audio_message" || kind.startsWith("audio/") || content.startsWith("audio/")) return "audio";
  if (kind === "image" || kind === "sticker" || kind.startsWith("image/") || content.startsWith("image/")) return "image";
  if (kind === "video" || kind === "ig_reel" || kind === "reel" || kind.startsWith("video/") || content.startsWith("video/")) return "video";
  return "file";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function httpsUrl(value: unknown): string {
  return typeof value === "string" && value.startsWith("https://") ? value : "";
}

export function readWebhookAttachments(raw: unknown): IncomingMedia[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(asRecord(raw)?.data) ? (asRecord(raw)?.data as unknown[]) : [];
  const found: IncomingMedia[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const payload = asRecord(row.payload);
    const url = httpsUrl(payload?.url) || httpsUrl(row.url) || httpsUrl(asRecord(row.image_data)?.url) || httpsUrl(asRecord(row.video_data)?.url) || httpsUrl(row.file_url);
    if (!url) continue;
    const type = typeof row.type === "string" ? row.type : typeof row.mime_type === "string" ? String(row.mime_type) : "file";
    found.push({ type, url });
    if (found.length >= MAX_FILES) break;
  }
  return found;
}

export async function loadGraphAttachmentUrls(messageId: string, pageToken: string): Promise<IncomingMedia[]> {
  if (!messageId || !pageToken) return [];
  const result = await graphCall(messageId, pageToken, { fields: "attachments" });
  if (graphCallFailed(result)) {
    console.warn("[instagram/media] Graph не віддав вкладення", sanitizeMeta(result.message));
    return [];
  }
  const attachments = result.data.attachments ?? result.data;
  return readWebhookAttachments(attachments);
}

type DownloadResult =
  | { ok: true; bytes: Buffer; mime: string }
  | { ok: false; reason: "too_big" | "failed" };

async function downloadMedia(url: string): Promise<DownloadResult> {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    console.warn(
      "[instagram/media] Файл не завантажився",
      sanitizeMeta(error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "https://***"),
    );
    return { ok: false, reason: "failed" };
  }
  if (!response.ok || !response.body) {
    console.warn("[instagram/media] Meta віддала файл з помилкою", response.status);
    return { ok: false, reason: "failed" };
  }
  const mime = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (mime.startsWith("text/html")) {
    console.warn("[instagram/media] Замість файлу прийшла сторінка");
    return { ok: false, reason: "failed" };
  }
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > MAX_BYTES) {
    console.warn("[instagram/media] Файл більший за ліміт", declared);
    return { ok: false, reason: "too_big" };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      console.warn("[instagram/media] Файл обірвано: більший за ліміт", total);
      return { ok: false, reason: "too_big" };
    }
    chunks.push(step.value);
  }
  if (!total) return { ok: false, reason: "failed" };
  return { ok: true, bytes: Buffer.concat(chunks), mime };
}

export async function storeDirectMessageMedia(input: {
  dbMessageId: string;
  clientId: string;
  files: IncomingMedia[];
}): Promise<{ stored: StoredMedia[]; tooBig: number }> {
  const existing = await prisma.directMessageMedia.findMany({
    where: { messageId: input.dbMessageId },
    select: { id: true, kind: true, mime: true, byteSize: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing.length > 0 || input.files.length === 0) return { stored: existing, tooBig: 0 };

  const stored: StoredMedia[] = [];
  let tooBig = 0;
  for (const file of input.files.slice(0, MAX_FILES)) {
    const downloaded = await downloadMedia(file.url);
    if (!downloaded.ok) {
      if (downloaded.reason === "too_big") tooBig += 1;
      continue;
    }
    const kind = mediaKind(file.type, downloaded.mime);
    const row = await prisma.directMessageMedia.create({
      data: {
        messageId: input.dbMessageId,
        clientId: input.clientId,
        kind,
        mime: downloaded.mime || "application/octet-stream",
        byteSize: downloaded.bytes.length,
        bytes: downloaded.bytes,
      },
      select: { id: true, kind: true, mime: true, byteSize: true },
    });
    stored.push(row);
    console.log("[instagram/media] Файл збережено", { kind: row.kind, mime: row.mime, byteSize: row.byteSize });
  }
  return { stored, tooBig };
}
