import { createHmac, timingSafeEqual } from "crypto";

/** Підпис Notion: заголовок X-Notion-Signature = sha256= + hex HMAC-SHA256(raw body). */
export function notionSignature(rawBody: string, verificationToken: string): string {
  const hex = createHmac("sha256", verificationToken).update(rawBody, "utf8").digest("hex");
  return `sha256=${hex}`;
}

export function verifyNotionSignature(
  rawBody: string,
  header: string | null,
  verificationToken: string,
): boolean {
  if (!header || !verificationToken) return false;
  const expected = notionSignature(rawBody, verificationToken);
  const actual = Buffer.from(header);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) return false;
  return timingSafeEqual(actual, wanted);
}

/** Id поля у вебхуку приходить URL-encoded (`srM%3C` → `srM<`). */
export function decodePropertyId(raw: string): string {
  const value = raw.trim();
  if (!value) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
