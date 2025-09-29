// web/app/(admin)/admin/campaigns/delete/route.ts
// GET /admin/campaigns/delete?id=<ID>
// HARD delete: DEL campaign:<id> + LREM id з індексів, далі редірект на список.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INDEX_KEY = 'campaign:index';
const LEGACY_INDEX = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaign:${id}`;

function base() {
  return (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
}
function wrToken() {
  return process.env.KV_REST_API_TOKEN || '';
}

async function rest(path: string, init: RequestInit = {}) {
  const url = `${base()}/${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${wrToken()}`,
    },
    cache: 'no-store',
  });
  return res;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = (url.searchParams.get('id') || '').trim();

  // Якщо немає ID або немає WR токена — просто назад у список
  if (!id || !wrToken() || !base()) {
    url.pathname = '/admin/campaigns';
    url.search = '?deleted=1';
    return NextResponse.redirect(url, 303);
  }

  try {
    // 1) DEL campaign:<id>
    await rest(`del/${encodeURIComponent(ITEM_KEY(id))}`, { method: 'POST' }).catch(() => null);

    // 2) LREM з основного індексу
    await rest(`lrem/${encodeURIComponent(INDEX_KEY)}/0`, {
      method: 'POST',
      body: JSON.stringify({ value: id }),
    }).catch(() => null);

    // 3) LREM зі старого індексу (на випадок історичних записів)
    await rest(`lrem/${encodeURIComponent(LEGACY_INDEX)}/0`, {
      method: 'POST',
      body: JSON.stringify({ value: id }),
    }).catch(() => null);
  } catch {
    // ігноруємо помилки – головне, щоб користувач повернувся до списку
  }

  // редірект назад у список з банером
  url.pathname = '/admin/campaigns';
  url.search = '?deleted=1';
  return NextResponse.redirect(url, 303);
}
