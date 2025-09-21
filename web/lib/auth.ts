// web/lib/auth.ts
import type { NextRequest } from 'next/server';

function readBearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

function readPassParam(req: NextRequest): string | null {
  try {
    const url = new URL(req.url);
    const pass = url.searchParams.get('pass');
    return pass ? pass.trim() : null;
  } catch {
    return null;
  }
}

function pickToken(req: NextRequest): string | null {
  return readBearer(req) ?? readPassParam(req) ?? null;
}

export async function assertAdmin(req: NextRequest): Promise<void> {
  const token = pickToken(req);
  const expected = process.env.ADMIN_PASS?.trim();
  if (!expected) {
    throw new Error('ADMIN_PASS is not configured');
  }
  if (!token || token !== expected) {
    const e: any = new Error('Unauthorized (admin)');
    e.status = 401;
    throw e;
  }
}

export async function assertMc(req: NextRequest): Promise<void> {
  const token = pickToken(req);
  const expected = process.env.MC_TOKEN?.trim();
  if (!expected) {
    throw new Error('MC_TOKEN is not configured');
  }
  if (!token || token !== expected) {
    const e: any = new Error('Unauthorized (manychat)');
    e.status = 401;
    throw e;
  }
}

// Опціонально: зручно мати "мʼякі" перевірки
export function isAdmin(req: NextRequest): boolean {
  const token = pickToken(req);
  const expected = process.env.ADMIN_PASS?.trim();
  return !!expected && token === expected;
}

export function isMc(req: NextRequest): boolean {
  const token = pickToken(req);
  const expected = process.env.MC_TOKEN?.trim();
  return !!expected && token === expected;
}
