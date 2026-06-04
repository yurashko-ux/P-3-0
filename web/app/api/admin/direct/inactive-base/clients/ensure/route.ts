// Додати клієнта Direct у список «Неактивної бази» (критерій 101+ днів) за ПІБ або clientId.

import { NextRequest, NextResponse } from 'next/server';
import { attachClientsToCampaignAudience } from '@/lib/inactive-base/campaign-audience';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';
import {
  ensureDirectClientInInactiveBaseList,
  findDirectClientsByNameParts,
} from '@/lib/inactive-base/ensure-client-in-list';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
    const campaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : '';

    let targetId = clientId;

    if (!targetId) {
      let partA = firstName;
      let partB = lastName;
      if (!partA && !partB && name) {
        const parts = name.split(/\s+/).filter(Boolean);
        partA = parts[0] ?? '';
        partB = parts.slice(1).join(' ') || parts[0] || '';
      }
      if (!partA && !partB) {
        return NextResponse.json(
          { ok: false, error: 'Вкажіть clientId або імʼя (name / firstName + lastName)' },
          { status: 400 }
        );
      }

      const matches = await findDirectClientsByNameParts(partA, partB);
      if (matches.length === 0) {
        return NextResponse.json(
          { ok: false, error: `Клієнта не знайдено в Direct за запитом «${partA} ${partB}»` },
          { status: 404 }
        );
      }
      if (matches.length > 1) {
        return NextResponse.json({
          ok: false,
          error: 'Знайдено кілька клієнтів — вкажіть clientId',
          matches: matches.map((c) => ({
            id: c.id,
            name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.instagramUsername,
            instagramUsername: c.instagramUsername,
            phone: c.phone,
          })),
        }, { status: 409 });
      }
      targetId = matches[0].id;
    }

    const result = await ensureDirectClientInInactiveBaseList(targetId);

    let campaignAttached = 0;
    if (campaignId) {
      const campaign = await prisma.inactiveBaseCampaign.findUnique({
        where: { id: campaignId },
        select: { id: true, bodyTemplate: true },
      });
      if (!campaign) {
        return NextResponse.json({ ok: false, error: 'Кампанію не знайдено' }, { status: 404 });
      }
      campaignAttached = await attachClientsToCampaignAudience(
        campaign.id,
        [targetId],
        campaign.bodyTemplate
      );
    }

    const displayName = [result.firstName, result.lastName].filter(Boolean).join(' ').trim();

    console.log(
      `[inactive-base/clients/ensure] clientId=${targetId} name=${displayName} updated=${result.updated} campaignAttached=${campaignAttached}`
    );

    return NextResponse.json({
      ok: true,
      ...result,
      displayName,
      campaignAttached,
      message: result.alreadyEligible
        ? `${displayName || targetId} уже в неактивній базі (${result.daysSinceLastVisit ?? '—'} днів)`
        : `${displayName || targetId} додано в неактивну базу (${result.daysSinceLastVisit ?? '—'} днів з останнього візиту)`,
      inactiveBaseUrl: 'https://p-3-0.vercel.app/admin/direct/inactive-base',
    });
  } catch (error) {
    console.error('[inactive-base/clients/ensure] POST error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
