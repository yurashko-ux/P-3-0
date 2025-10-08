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

  const args = {
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
  } as const;

  const primary = await findCardSimple(args);

  const attempts: Array<{
    scope: string | null | undefined;
    ok: unknown;
    result: unknown;
    stats: unknown;
    used: unknown;
  }> = [
    {
      scope: (primary as any)?.scope ?? scope ?? null,
      ok: (primary as any)?.ok,
      result: (primary as any)?.result ?? null,
      stats: (primary as any)?.stats ?? null,
      used: (primary as any)?.used ?? null,
    },
  ];

  const requestedScope = scope ?? null;
  const shouldFallback =
    (primary as any)?.ok === true &&
    !(primary as any)?.result &&
    (requestedScope === null || requestedScope === 'campaign');

  if (shouldFallback) {
    const fallback = await findCardSimple({ ...args, scope: 'global' });

    attempts.push({
      scope: (fallback as any)?.scope ?? 'global',
      ok: (fallback as any)?.ok,
      result: (fallback as any)?.result ?? null,
      stats: (fallback as any)?.stats ?? null,
      used: (fallback as any)?.used ?? null,
    });

    const payload: any = {
      ...fallback,
      attempts,
      fallback_scope: 'global',
      fallback_from_scope: (primary as any)?.scope ?? requestedScope ?? 'campaign',
      fallback_previous: {
        result: (primary as any)?.result ?? null,
        stats: (primary as any)?.stats ?? null,
        used: (primary as any)?.used ?? null,
      },
    };

    return NextResponse.json(payload, { status: 200 });
  }

  return NextResponse.json({ ...primary, attempts }, { status: 200 });
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
