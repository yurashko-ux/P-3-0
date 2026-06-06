// web/app/api/admin/direct/inactive-base/campaigns/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';
import { syncCampaignAudienceLinkTracking } from '@/lib/inactive-base/campaign-link-tracking';

export const dynamic = 'force-dynamic';

function parseChannels(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x === 'telegram' || x === 'instagram').map(String);
}

async function resolveParams(params: { id: string } | Promise<{ id: string }>) {
  return params instanceof Promise ? await params : params;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await resolveParams(params);
  try {
    const item = await prisma.inactiveBaseCampaign.findUnique({
      where: { id },
      include: {
        runs: { orderBy: { startedAt: 'desc' }, take: 20 },
      },
    });
    if (!item) {
      return NextResponse.json({ ok: false, error: 'Кампанію не знайдено' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    console.error('[inactive-base/campaigns/[id]] GET error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await resolveParams(params);
  try {
    const body = await req.json().catch(() => ({}));
    const data: {
      name?: string;
      bodyTemplate?: string;
      channels?: string[];
      linkLabel?: string | null;
      linkUrl?: string | null;
    } = {};
    if (body.name != null) {
      const name = String(body.name).trim();
      if (!name) {
        return NextResponse.json({ ok: false, error: 'Назва не може бути порожньою' }, { status: 400 });
      }
      data.name = name;
    }
    if (body.bodyTemplate != null) {
      const t = String(body.bodyTemplate).trim();
      if (!t) {
        return NextResponse.json({ ok: false, error: 'Текст не може бути порожнім' }, { status: 400 });
      }
      data.bodyTemplate = t;
    }
    const ch = parseChannels(body.channels);
    if (ch !== undefined) data.channels = ch;
    if (body.linkLabel !== undefined) {
      const v = String(body.linkLabel).trim();
      data.linkLabel = v || null;
    }
    if (body.linkUrl !== undefined) {
      const v = String(body.linkUrl).trim();
      data.linkUrl = v || null;
    }

    const item = await prisma.inactiveBaseCampaign.update({
      where: { id },
      data,
    });

    const linkFieldsChanged =
      body.bodyTemplate !== undefined ||
      body.linkLabel !== undefined ||
      body.linkUrl !== undefined;
    let linkSync: { processed: number; updatedBodies: number } | null = null;
    if (linkFieldsChanged) {
      linkSync = await syncCampaignAudienceLinkTracking(id);
    }

    return NextResponse.json({ ok: true, item, linkSync });
  } catch (error) {
    console.error('[inactive-base/campaigns/[id]] PATCH error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await resolveParams(params);
  try {
    await prisma.inactiveBaseCampaign.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[inactive-base/campaigns/[id]] DELETE error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
