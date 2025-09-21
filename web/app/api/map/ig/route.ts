// web/app/api/map/ig/route.ts
import { NextResponse } from 'next/server';

type ManyChatIn =
  | {
      full_name?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    }
  | Record<string, any>;

/**
 * Normalizes ManyChat IG payload to { title, handle? }.
 * Usage: POST with JSON body from ManyChat webhook/middleware.
 */
export async function POST(req: Request) {
  let payload: ManyChatIn;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const first = (payload.first_name ?? '').trim();
  const last = (payload.last_name ?? '').trim();
  const fromParts = [first, last].filter(Boolean).join(' ').trim();

  const title =
    (payload.full_name?.trim() || fromParts || '').trim() || 'Unknown';

  const handle = (payload.username?.trim() || undefined) as string | undefined;

  return NextResponse.json({ title, handle });
}
