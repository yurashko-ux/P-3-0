// web/app/api/admin/direct/sync-altegio/route.ts
// Синхронізація клієнта з Altegio за Instagram username

import { NextRequest, NextResponse } from 'next/server';
import { getDirectClient, saveDirectClient } from '@/lib/direct-store';
import { getClients } from '@/lib/altegio/clients';
import { getEnvValue } from '@/lib/env';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

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
        (c.custom_fields && (
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
      // Оновлюємо Direct клієнта з даними Altegio
      const updated: typeof directClient = {
        ...directClient,
        altegioClientId: altegioClient.id,
        ...(altegioClient.name && !directClient.firstName && {
          firstName: altegioClient.name.split(' ')[0],
          lastName: altegioClient.name.split(' ').slice(1).join(' '),
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
