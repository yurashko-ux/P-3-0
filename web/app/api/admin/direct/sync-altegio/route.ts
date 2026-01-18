// web/app/api/admin/direct/sync-altegio/route.ts
// Синхронізація клієнта з Altegio за Instagram username

import { NextRequest, NextResponse } from 'next/server';
import { getDirectClient, saveDirectClient } from '@/lib/direct-store';
import { getClients } from '@/lib/altegio/clients';
import { getEnvValue } from '@/lib/env';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isBadNamePart(v?: string | null): boolean {
  if (!v) return true;
  const t = String(v).trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (t.includes('{{') || t.includes('}}')) return true;
  if (lower === 'not found') return true;
  return false;
}

function looksInstagramSourced(firstName?: string | null, lastName?: string | null): boolean {
  const fn = String(firstName || '').trim();
  const ln = String(lastName || '').trim();
  if (!fn && !ln) return true;
  const isAllCapsSingle = !!fn && !ln && fn.length >= 3 && fn === fn.toUpperCase() && !/\s/.test(fn);
  return isAllCapsSingle;
}

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/**
 * POST - синхронізувати клієнта з Altegio
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { clientId, instagramUsername } = body;

    if (!clientId && !instagramUsername) {
      return NextResponse.json(
        { ok: false, error: 'Either clientId or instagramUsername is required' },
        { status: 400 }
      );
    }

    // Отримуємо Direct клієнта
    let directClient;
    if (clientId) {
      const { getDirectClient } = await import('@/lib/direct-store');
      directClient = await getDirectClient(clientId);
      if (!directClient) {
        return NextResponse.json({ ok: false, error: 'Direct client not found' }, { status: 404 });
      }
    } else {
      const { getDirectClientByInstagram } = await import('@/lib/direct-store');
      directClient = await getDirectClientByInstagram(instagramUsername!);
      if (!directClient) {
        return NextResponse.json({ ok: false, error: 'Direct client not found' }, { status: 404 });
      }
    }

    // Шукаємо клієнта в Altegio
    const companyIdStr = getEnvValue('ALTEGIO_COMPANY_ID');
    if (!companyIdStr) {
      return NextResponse.json(
        { ok: false, error: 'Altegio company ID not configured' },
        { status: 500 }
      );
    }
    const companyId = parseInt(companyIdStr, 10);
    if (isNaN(companyId)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid Altegio company ID' },
        { status: 500 }
      );
    }

    const clients = await getClients(companyId, 1000); // Отримуємо більше клієнтів для пошуку

    // Шукаємо по Instagram username в custom_fields
    const instagram = directClient.instagramUsername.toLowerCase();
    const altegioClient = clients.find((c) => {
      // Перевіряємо різні варіанти назв полів Instagram
      const igField = 
        c['instagram-user-name'] ||
        c.instagram_user_name ||
        c.instagramUsername ||
        c.instagram_username ||
        (c.custom_fields && typeof c.custom_fields === 'object' && !Array.isArray(c.custom_fields) && (
          c.custom_fields['instagram-user-name'] ||
          c.custom_fields.instagram_user_name ||
          c.custom_fields.instagramUsername ||
          c.custom_fields.instagram_username
        ));

      if (igField && typeof igField === 'string') {
        return igField.toLowerCase() === instagram;
      }
      return false;
    });

    if (altegioClient) {
      const altegioName = (altegioClient.name || '').toString().trim();
      const shouldReplaceName =
        Boolean(altegioName) &&
        (isBadNamePart(directClient.firstName) ||
          isBadNamePart(directClient.lastName) ||
          looksInstagramSourced(directClient.firstName, directClient.lastName));

      // Оновлюємо Direct клієнта з даними Altegio
      const updated: typeof directClient = {
        ...directClient,
        altegioClientId: altegioClient.id,
        ...(shouldReplaceName && {
          firstName: altegioName.split(' ')[0],
          lastName: altegioName.split(' ').slice(1).join(' '),
        }),
        updatedAt: new Date().toISOString(),
      };

      await saveDirectClient(updated);
      return NextResponse.json({ ok: true, client: updated, altegioClient });
    } else {
      return NextResponse.json({ ok: true, client: directClient, altegioClient: null, message: 'Client not found in Altegio' });
    }
  } catch (error) {
    console.error('[direct/sync-altegio] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
