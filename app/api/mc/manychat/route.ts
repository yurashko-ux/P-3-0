// app/api/mc/manychat/route.ts
// Проксі-ендпойнт для ManyChat → /api/mc/ingest з тими самими body/headers (де потрібно).
// Додає в query обмеження пошуку (воронка/статус), якщо вони є в ENV.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const base = new URL(req.url);
  const body = await req.json().catch(() => ({}));

  const qs = new URLSearchParams(base.search);
  // Додаємо ліміти з ENV, якщо їх не передали ззовні:
  if (!qs.get('pipeline_id') && process.env.MC_LIMIT_PIPELINE_ID) {
    qs.set('pipeline_id', String(process.env.MC_LIMIT_PIPELINE_ID));
  }
  if (!qs.get('status_id') && process.env.MC_LIMIT_STATUS_ID) {
    qs.set('status_id', String(process.env.MC_LIMIT_STATUS_ID));
  }
  if (!qs.get('max_pages') && process.env.MC_SEARCH_MAX_PAGES) {
    qs.set('max_pages', String(process.env.MC_SEARCH_MAX_PAGES));
  }

  const ingestUrl = `${base.origin}/api/mc/ingest?${qs.toString()}`;

  const res = await fetch(ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Усі потрібні поля з ManyChat вже в body; x-vercel-protection-bypass ManyChat кладе у Headers самого запиту до твого домену,
    // а не у внутрішній fetch — тому повторно його додавати тут не потрібно.
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
