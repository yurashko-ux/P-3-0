// web/app/api/keycrm/_common.ts
export const runtime = "nodejs";

export function baseUrl() {
  return (process.env.KEYCRM_API_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");
}

export function buildAuth(): string {
  const bearer = process.env.KEYCRM_BEARER?.trim();
  const token = process.env.KEYCRM_API_TOKEN?.trim();
  if (bearer) return bearer;
  if (token) return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
  return "";
}

export function authHeaders() {
  const auth = buildAuth();
  const h: Record<string, string> = { Accept: "application/json" };
  if (auth) h.Authorization = auth;
  return h;
}

export function maskAuth(a?: string) {
  if (!a) return "(no auth)";
  const s = a.toLowerCase().startsWith("bearer ") ? a.slice(7) : a;
  const head = s.slice(0, 6);
  return (a.toLowerCase().startsWith("bearer ") ? "Bearer " : "") + (s.length <= 8 ? "***" : `${head}…***`);
}
