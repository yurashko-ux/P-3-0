// web/app/api/keycrm/find/route.ts
import { NextResponse } from 'next/server';
import { findCardSimple } from '@/lib/keycrm-find';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Strategy = 'social' | 'title' | 'both';
type TitleMode = 'exact' | 'contains';
type Scope = 'campaign' | 'global';

function parseNumber(value?: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function handleRequest(params: URLSearchParams) {
  const username = params.get('username')?.trim();
  const full_name = params.get('full_name')?.trim();
  const social_name = params.get('social_name')?.trim();

  const pipeline_id = parseNumber(params.get('pipeline_id'));
  const status_id = parseNumber(params.get('status_id'));

  const max_pages = parseNumber(params.get('max_pages'));
  const page_size = parseNumber(params.get('page_size'));

  const strategy = (params.get('strategy') as Strategy | null) ?? undefined;
  const title_mode = (params.get('title_mode') as TitleMode | null) ?? undefined;
  const scope = (params.get('scope') as Scope | null) ?? undefined;

  const result = await findCardSimple({
    username: username || undefined,
    full_name: full_name || undefined,
    social_name: social_name || undefined,
    pipeline_id,
    status_id,
    max_pages,
    page_size,
    strategy,
    title_mode,
    scope,
  });

  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    return await handleRequest(url.searchParams);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: 'server_error', message: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body || {})) {
      if (value == null) continue;
      if (typeof value === 'string' || typeof value === 'number') {
        params.set(key, String(value));
      }
    }
    return await handleRequest(params);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: 'server_error', message: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}
