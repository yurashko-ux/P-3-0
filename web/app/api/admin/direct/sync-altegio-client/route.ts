// web/app/api/admin/direct/sync-altegio-client/route.ts
// Синхронізація клієнта з Altegio за client ID (отримуємо повні дані через API)

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, getAllDirectStatuses, saveDirectClient } from '@/lib/direct-store';
import { getClient } from '@/lib/altegio/clients';
import { normalizeInstagram } from '@/lib/normalize';
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
 * POST - синхронізувати клієнта з Altegio за client ID
 * Отримуємо повні дані клієнта через API (з custom_fields)
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { altegioClientId } = body;

    if (!altegioClientId) {
      return NextResponse.json(
        { ok: false, error: 'altegioClientId is required' },
        { status: 400 }
      );
    }

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

    const clientId = parseInt(String(altegioClientId), 10);
    if (isNaN(clientId)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid Altegio client ID' },
        { status: 400 }
      );
    }

    console.log(`[direct/sync-altegio-client] Fetching client ${clientId} from Altegio...`);

    // Отримуємо повні дані клієнта через API (з custom_fields)
    const altegioClient = await getClient(companyId, clientId);

    if (!altegioClient) {
      return NextResponse.json(
        { ok: false, error: `Client ${clientId} not found in Altegio` },
        { status: 404 }
      );
    }

    console.log(`[direct/sync-altegio-client] Got client ${clientId}:`, {
      name: altegioClient.name || altegioClient.display_name,
      hasCustomFields: !!altegioClient.custom_fields,
      customFieldsType: typeof altegioClient.custom_fields,
      customFieldsIsArray: Array.isArray(altegioClient.custom_fields),
    });

    // Витягуємо Instagram username з custom_fields
    let instagram: string | null = null;

    if (altegioClient.custom_fields) {
      if (Array.isArray(altegioClient.custom_fields)) {
        for (const field of altegioClient.custom_fields) {
          if (field && typeof field === 'object') {
            const title = field.title || field.name || field.label || '';
            const value = field.value || field.data || field.content || field.text || '';
            
            if (value && typeof value === 'string' && /instagram/i.test(title)) {
              instagram = value.trim();
              break;
            }
          }
        }
      } else if (typeof altegioClient.custom_fields === 'object' && !Array.isArray(altegioClient.custom_fields)) {
        instagram =
          altegioClient.custom_fields['instagram-user-name'] ||
          altegioClient.custom_fields['Instagram user name'] ||
          altegioClient.custom_fields['Instagram username'] ||
          altegioClient.custom_fields.instagram_user_name ||
          altegioClient.custom_fields.instagramUsername ||
          altegioClient.custom_fields.instagram ||
          null;
      }
    }

    if (!instagram) {
      return NextResponse.json({
        ok: false,
        error: 'No Instagram username found in custom_fields',
        client: {
          id: altegioClient.id,
          name: altegioClient.name || altegioClient.display_name,
          customFields: altegioClient.custom_fields,
        },
      }, { status: 400 });
    }

    const normalizedInstagram = normalizeInstagram(instagram);
    if (!normalizedInstagram) {
      return NextResponse.json({
        ok: false,
        error: `Invalid Instagram username: ${instagram}`,
      }, { status: 400 });
    }

    console.log(`[direct/sync-altegio-client] ✅ Extracted Instagram: ${normalizedInstagram}`);

    // Отримуємо статус за замовчуванням
    const allStatuses = await getAllDirectStatuses();
    const defaultStatus = allStatuses.find(s => s.isDefault) || allStatuses.find(s => s.id === 'new') || allStatuses[0];
    if (!defaultStatus) {
      return NextResponse.json({
        ok: false,
        error: 'No default status found',
      }, { status: 500 });
    }

    // Отримуємо існуючих клієнтів для перевірки дублікатів
    const existingDirectClients = await getAllDirectClients();
    const existingInstagramMap = new Map<string, string>();
    const existingAltegioIdMap = new Map<number, string>();
    
    for (const dc of existingDirectClients) {
      const normalized = normalizeInstagram(dc.instagramUsername);
      if (normalized) {
        existingInstagramMap.set(normalized, dc.id);
      }
      if (dc.altegioClientId) {
        existingAltegioIdMap.set(dc.altegioClientId, dc.id);
      }
    }

    // Витягуємо ім'я
    const nameParts = (altegioClient.name || altegioClient.display_name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || undefined;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

    // Шукаємо існуючого клієнта
    let existingClientId = existingInstagramMap.get(normalizedInstagram);
    if (!existingClientId) {
      existingClientId = existingAltegioIdMap.get(clientId);
    }

    if (existingClientId) {
      // Оновлюємо існуючого клієнта
      const existingClient = existingDirectClients.find((c) => c.id === existingClientId);
      if (existingClient) {
        const updated: typeof existingClient = {
          ...existingClient,
          altegioClientId: clientId,
          instagramUsername: normalizedInstagram,
          state: 'client' as const,
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          updatedAt: new Date().toISOString(),
        };
        await saveDirectClient(updated);
        console.log(`[direct/sync-altegio-client] ✅ Updated Direct client ${existingClientId} from Altegio client ${clientId}`);
        return NextResponse.json({
          ok: true,
          action: 'updated',
          client: updated,
          altegioClient: {
            id: altegioClient.id,
            name: altegioClient.name || altegioClient.display_name,
            instagram: normalizedInstagram,
          },
        });
      }
    } else {
      // Створюємо нового клієнта
      const now = new Date().toISOString();
      const newClient = {
        id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        instagramUsername: normalizedInstagram,
        firstName,
        lastName,
        source: 'instagram' as const,
        state: 'client' as const,
        firstContactDate: now,
        statusId: defaultStatus.id,
        visitedSalon: false,
        signedUpForPaidService: false,
        altegioClientId: clientId,
        createdAt: now,
        updatedAt: now,
      };
      await saveDirectClient(newClient);
      console.log(`[direct/sync-altegio-client] ✅ Created Direct client ${newClient.id} from Altegio client ${clientId}`);
      return NextResponse.json({
        ok: true,
        action: 'created',
        client: newClient,
        altegioClient: {
          id: altegioClient.id,
          name: altegioClient.name || altegioClient.display_name,
          instagram: normalizedInstagram,
        },
      });
    }
  } catch (error) {
    console.error('[direct/sync-altegio-client] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
