// web/app/api/keycrm/search/route.ts
import { NextResponse } from 'next/server';
import { kcFindCardIdByAny } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

function optStr(v: string | null): string | undefined {
  const s = (v ?? '').trim();
  return s ? s : undefined;
}
function optNumOrStr(v: string | null): number | string | undefined {
  const s = (v ?? '').trim();
  if (!s) return undefined;
  return /^\d+$/.test(s) ? Number(s) : s;
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);

    // raw params (можуть бути null)
    const usernameRaw = u.searchParams.get('username');
    const fullnameRaw = u.searchParams.get('fullname') // вже правильна назва
      ?? u.searchParams.get('full_name')
      ?? u.searchParams.get('name');

    const first = u.searchParams.get('first_name');
    const last = u.searchParams.get('last_name');

    // складання fullname, якщо не прийшло явно
    const composedFull =
      (optStr(fullnameRaw)) ??
      optStr([first ?? '', last ?? ''].join(' ').trim());

    const pipeline_id = optNumOrStr(u.searchParams.get('pipeline_id'));
    const status_id   = optNumOrStr(u.searchParams.get('status_id'));

    // limit → per_page; також приймаємо per_page/max_pages напряму
    const per_page =
      Number(u.searchParams.get('per_page') ??
            u.searchParams.get('limit') ?? '') || undefined;

    const max_pages =
      Number(u.searchParams.get('max_pages') ?? '') || undefined;

    // нормалізуємо username до undefined, не null
    const username = optStr(usernameRaw);

    const args: {
      username?: string;
      fullname?: string;
      pipeline_id?: number | string;
      status_id?: number | string;
      per_page?: number;
      max_pages?: number;
    } = {
      username,
      fullname: composedFull,
      pipeline_id,
      status_id,
      per_page,
      max_pages,
    };

    const result: any = await kcFindCardIdByAny(args).catch(() => null);

    return NextResponse.json(
      { ok: !!(result && result.ok), result, used: args },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'failed' },
      { status: 500 }
    );
  }
}
