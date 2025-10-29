// web/app/api/keycrm/_common.ts
export const runtime = "nodejs";

export function baseUrl() {
  return (
    process.env.KEYCRM_API_URL ||
    process.env.KEYCRM_BASE_URL ||
    "https://openapi.keycrm.app/v1"
  ).replace(/\/+$/, "");
}

export function ensureBearer(v?: string) {
  if (!v) return "";
  const s = v.trim();
  if (!s) return "";
  return s.toLowerCase().startsWith("bearer ") ? s : `Bearer ${s}`;
}

export function buildAuth(): string {
  // Нормалізуємо всі відомі джерела токена
  const direct = ensureBearer(process.env.KEYCRM_BEARER);
  const apiToken = ensureBearer(process.env.KEYCRM_API_TOKEN);
  const legacy = ensureBearer(process.env.KEYCRM_TOKEN);
  return direct || apiToken || legacy || "";
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
