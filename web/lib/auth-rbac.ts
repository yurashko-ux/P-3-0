// web/lib/auth-rbac.ts
// RBAC: перевірка доступу через admin_token (супер-адмін) або user session (AppUser)

import { createHmac, timingSafeEqual } from "crypto";
import * as bcrypt from "bcryptjs";
import { prisma } from "./prisma";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.CRON_SECRET || "fallback-secret-change-me";

export type PermissionKey =
  | "finances"
  | "salesColumn"
  | "actionsColumn"
  | "instCreateStatuses"
  | "callsListen"
  | "statusesCreateSubsection"
  | "phoneOutgoingCalls"
  | "statsSection"
  | "financeReportSection"
  | "bankSection"
  | "bankOneSection"
  | "debugSection"
  | "accessSection";

export type PermissionValue = "view" | "edit" | "none";

export type Permissions = Partial<Record<PermissionKey, PermissionValue>>;

const DEFAULT_PERMISSIONS: Permissions = {
  finances: "edit",
  salesColumn: "edit",
  actionsColumn: "edit",
  instCreateStatuses: "edit",
  callsListen: "edit",
  statusesCreateSubsection: "edit",
  phoneOutgoingCalls: "edit",
  statsSection: "edit",
  financeReportSection: "edit",
  bankSection: "edit",
  bankOneSection: "edit",
  debugSection: "edit",
  accessSection: "edit",
};

function getCookie(req: Request, name: string): string | null {
  const all = req.headers.get("cookie");
  if (!all) return null;
  const parts = all.split(/;\s*/);
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    if (decodeURIComponent((k || "").trim()) === name) {
      return decodeURIComponent((rest.join("=") || "").trim());
    }
  }
  return null;
}

function signUserId(userId: string): string {
  return createHmac("sha256", AUTH_SECRET).update(userId).digest("hex").slice(0, 16);
}

/** Перевіряє user session token (sync, для middleware). */
export function verifyUserToken(token: string): string | null {
  const match = token.match(/^u:([a-f0-9-]+):([a-f0-9]+)$/i);
  if (!match) return null;
  const [, userId, sig] = match;
  const expected = signUserId(userId);
  if (expected.length !== sig.length) return null;
  try {
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return userId;
  } catch {
    return null;
  }
  return null;
}

/** Повертає auth-контекст: супер-адмін або користувач з permissions */
export type AuthContext =
  | { type: "superadmin"; userId: null; permissions: Permissions }
  | { type: "user"; userId: string; userName: string; login: string; permissions: Permissions };

export async function getAuthContext(req: Request): Promise<AuthContext | null> {
  const adminToken = getCookie(req, "admin_token");
  if (!adminToken) return null;

  if (adminToken === ADMIN_PASS && ADMIN_PASS) {
    return { type: "superadmin", userId: null, permissions: { ...DEFAULT_PERMISSIONS } };
  }

  const userId = verifyUserToken(adminToken);
  if (!userId) return null;

  const user = await prisma.appUser.findUnique({
    where: { id: userId, isActive: true },
    include: { function: true },
  });
  if (!user) return null;

  let permissions: Permissions = { ...DEFAULT_PERMISSIONS };
  if (user.function?.permissions && typeof user.function.permissions === "object") {
    const p = user.function.permissions as Record<string, string>;
    for (const k of Object.keys(p)) {
      if (p[k] === "view" || p[k] === "edit" || p[k] === "none") {
        permissions[k as PermissionKey] = p[k] as PermissionValue;
      }
    }
  }

  return {
    type: "user",
    userId: user.id,
    userName: user.name,
    login: user.login,
    permissions,
  };
}

/** Перевірка авторизації (як isAuthorized в API). Дозволяє супер-адміна, Bearer CRON_SECRET, та сесію user. */
export async function isAuthorized(req: Request): Promise<boolean> {
  const auth = await getAuthContext(req);
  if (auth) return true;

  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.replace(/^bearer\s+/i, "").trim();
  if (CRON_SECRET && bearer === CRON_SECRET) return true;

  try {
    const url = new URL(req.url);
    if (url.searchParams.get("secret") === CRON_SECRET && CRON_SECRET) return true;
  } catch {}

  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/** Перевірка права доступу. Якщо permission === "none" — заборонено. */
export function hasPermission(permissions: Permissions, key: PermissionKey): boolean {
  const v = permissions[key];
  if (!v || v === "none") return false;
  return true;
}

/** Чи дозволено змінювати (edit). */
export function canEdit(permissions: Permissions, key: PermissionKey): boolean {
  return permissions[key] === "edit";
}

/** Генерує токен для user session (для встановлення в cookie). */
export function createUserSessionToken(userId: string): string {
  return `u:${userId}:${signUserId(userId)}`;
}

/** Аліас для сумісності. */
export const createUserSessionCookie = createUserSessionToken;

/** Хешує пароль (bcryptjs — pure JS, без нативних модулів для Vercel). */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hashSync(plain, 10);
}

/** Перевіряє пароль проти хешу. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compareSync(plain, hash);
}
