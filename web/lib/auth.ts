// web/lib/auth.ts
import type { NextRequest } from "next/server";

function getPassFromReq(req: NextRequest | Request): string | null {
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (header && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  try {
    const url = new URL(req.url);
    const p = url.searchParams.get("pass");
    if (p) return p.trim();
  } catch {}
  return null;
}

export async function assertAdmin(req: NextRequest | Request): Promise<void> {
  const expected = process.env.ADMIN_PASS || "11111";
  const got = getPassFromReq(req);
  if (!got || got !== expected) {
    throw new Error("Unauthorized");
  }
}

export function isAdmin(req: NextRequest | Request): boolean {
  const expected = process.env.ADMIN_PASS || "11111";
  const got = getPassFromReq(req);
  return !!got && got === expected;
}
