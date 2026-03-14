// web/lib/auth-token.ts
// Перевірка user session token для middleware (Edge-сумісний, Web Crypto API)

const AUTH_SECRET = process.env.AUTH_SECRET || process.env.CRON_SECRET || "fallback-secret-change-me";

/** Async перевірка user session token (Web Crypto, Edge-сумісний). */
export async function verifyUserTokenAsync(token: string): Promise<string | null> {
  const match = token.match(/^u:([a-f0-9-]+):([a-f0-9]+)$/i);
  if (!match) return null;
  const [, userId, sig] = match;
  if (!userId || !sig || sig.length !== 16) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(userId),
  );

  const arr = new Uint8Array(sigBuffer);
  const expectedHex = Array.from(arr)
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedHex.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    diff |= expectedHex.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0 ? userId : null;
}
