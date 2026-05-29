// web/app/api/admin/direct/inactive-base/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';

export const dynamic = 'force-dynamic';

function parseChannels(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x === 'telegram' || x === 'instagram').map(String);
}

export async function GET(req: NextRequest) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const items = await prisma.inactiveBaseCampaign.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            channel: true,
            startedAt: true,
            sentCount: true,
            failedCount: true,
            skippedCount: true,
            selectedCount: true,
          },
        },
      },
    });
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error('[inactive-base/campaigns] GET error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const name = (body.name || '').toString().trim();
    const bodyTemplate = (body.bodyTemplate || '').toString().trim();
    const channels = parseChannels(body.channels);
    if (!name) {
      return NextResponse.json({ ok: false, error: 'Назва кампанії обовʼязкова' }, { status: 400 });
    }
    if (!bodyTemplate) {
      return NextResponse.json({ ok: false, error: 'Текст кампанії обовʼязковий' }, { status: 400 });
    }
    const item = await prisma.inactiveBaseCampaign.create({
      data: {
        name,
        bodyTemplate,
        channels: channels.length ? channels : ['instagram', 'telegram'],
      },
    });
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    console.error('[inactive-base/campaigns] POST error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
