// web/app/api/admin/direct/clients/[id]/route.ts
// API endpoint для роботи з окремим Direct клієнтом

import { NextRequest, NextResponse } from 'next/server';
import {
  getDirectClient,
  getDirectClientByInstagram,
  saveDirectClient,
  deleteDirectClient,
  getDirectStatus,
  getAllDirectClients,
  isTransientDirectDbFailure,
} from '@/lib/direct-store';
import type { DirectClient } from '@/lib/direct-types';
import { normalizeInstagram } from '@/lib/normalize';
import { parseCommunicationChannelForPatch } from '@/lib/direct-communication-channel';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/** Підтримка params як об'єкт (Next 14) або Promise (Next 15) */
async function resolveParams(params: { id: string } | Promise<{ id: string }>): Promise<{ id: string }> {
  return typeof (params as any)?.then === 'function' ? await (params as Promise<{ id: string }>) : params as { id: string };
}

/**
 * GET - отримати клієнта за ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await resolveParams(params);
    if (!id || typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ ok: false, error: 'Client ID is required' }, { status: 400 });
    }
    const client = await getDirectClient(id);
    if (!client) {
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, client });
  } catch (error) {
    const { id } = await resolveParams(params).catch(() => ({ id: 'unknown' }));
    console.error(`[direct/clients/${id}] GET error:`, error);
    if (isTransientDirectDbFailure(error)) {
      return NextResponse.json(
        {
          ok: false,
          retryable: true,
          error: 'Тимчасовий збій бази даних. Спробуйте повторити запит.',
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH - оновити клієнта
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await resolveParams(params);
    if (!id || typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ ok: false, error: 'Client ID is required' }, { status: 400 });
    }
    let client = await getDirectClient(id);
    // Fallback 1: findUnique інколи не знаходить клієнта
    if (!client) {
      const all = await getAllDirectClients();
      client = all.find((c) => c.id === id) || all.find((c) => c.id === id.trim()) || null;
      if (client) console.log(`[direct/clients] Found via getAllDirectClients for id="${id}"`);
    }
    // Fallback 2: пошук за instagramUsername (якщо передано в body)
    const bodyPre = await req.json().catch(() => ({}));
    if (!client && bodyPre._fallbackInstagram) {
      client = await getDirectClientByInstagram(bodyPre._fallbackInstagram);
      if (client) console.log(`[direct/clients] Found via instagram fallback: ${bodyPre._fallbackInstagram}`);
    }
    if (!client) {
      console.warn(`[direct/clients] Client not found for id="${id}" (len=${id.length})`);
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }

    const body = { ...bodyPre };
    delete body._fallbackInstagram; // Не зберігаємо в клієнта

    /** Дозволена зміна Instagram username з UI (унікальність у direct_clients). */
    let resolvedInstagramUsername = client.instagramUsername;
    if (Object.prototype.hasOwnProperty.call(body, 'instagramUsername')) {
      const normalized = normalizeInstagram(String((body as Record<string, unknown>).instagramUsername ?? ''));
      if (!normalized) {
        return NextResponse.json(
          { ok: false, error: 'Невірний або порожній Instagram username' },
          { status: 400 }
        );
      }
      const currentNorm = (client.instagramUsername ?? '').trim().toLowerCase();
      if (normalized !== currentNorm) {
        const occupied = await getDirectClientByInstagram(normalized);
        if (occupied && occupied.id !== client.id) {
          return NextResponse.json(
            {
              ok: false,
              error: `Instagram @${normalized} вже зайнятий іншим клієнтом (id: ${occupied.id})`,
            },
            { status: 409 }
          );
        }
      }
      resolvedInstagramUsername = normalized;
    }
    delete (body as Record<string, unknown>).instagramUsername;

    if (Object.prototype.hasOwnProperty.call(body, 'communicationChannel')) {
      const parsedComm = parseCommunicationChannelForPatch((body as Record<string, unknown>).communicationChannel);
      if (parsedComm.ok === false) {
        console.warn('[direct/clients PATCH] Невалідний communicationChannel:', (body as Record<string, unknown>).communicationChannel);
        return NextResponse.json({ ok: false, error: parsedComm.error }, { status: 400 });
      }
      (body as Record<string, unknown>).communicationChannel = parsedComm.value;
    }
    // Перевіряємо, чи statusId існує (якщо оновлюємо статус)
    if (body.statusId != null) {
      const status = await getDirectStatus(String(body.statusId).trim());
      if (!status) {
        return NextResponse.json(
          { ok: false, error: 'Обраний статус не знайдено (можливо, його було видалено)' },
          { status: 400 }
        );
      }
    }
    const updated: DirectClient = {
      ...client,
      ...body,
      id: client.id, // Не дозволяємо змінювати ID
      instagramUsername: resolvedInstagramUsername,
      createdAt: client.createdAt, // Не дозволяємо змінювати дату створення
      // НЕ рухаємо updatedAt від ручних правок в UI (щоб таблиця не "пливла").
      updatedAt: client.updatedAt,
      // При зміні статусу — зберігаємо дату встановлення
      ...(body.statusId != null && { statusSetAt: new Date().toISOString() }),
    };

    const statusChanged = body.statusId != null && body.statusId !== client.statusId;
    const instagramChanged =
      (client.instagramUsername ?? '').trim().toLowerCase() !==
      (resolvedInstagramUsername ?? '').trim().toLowerCase();
    await saveDirectClient(updated, 'ui-patch-client', { clientId: client.id }, {
      touchUpdatedAt: statusChanged || instagramChanged,
    });
    // Повертаємо актуальний рядок з БД (усі колонки, у т.ч. communicationChannel після міграції)
    const persisted = await getDirectClient(client.id);
    if (!persisted) {
      console.warn(`[direct/clients PATCH] Після збереження getDirectClient повернув null для id=${client.id}`);
    }
    return NextResponse.json({ ok: true, client: persisted ?? updated });
  } catch (error) {
    const { id } = await resolveParams(params).catch(() => ({ id: 'unknown' }));
    console.error(`[direct/clients/${id}] PATCH error:`, error);
    if (isTransientDirectDbFailure(error)) {
      return NextResponse.json(
        {
          ok: false,
          retryable: true,
          error: 'Тимчасовий збій бази даних. Спробуйте повторити запит.',
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE - видалити клієнта
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await resolveParams(params);
    if (!id || typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ ok: false, error: 'Client ID is required' }, { status: 400 });
    }
    const client = await getDirectClient(id);
    if (!client) {
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }

    await deleteDirectClient(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { id } = await resolveParams(params).catch(() => ({ id: 'unknown' }));
    console.error(`[direct/clients/${id}] DELETE error:`, error);
    if (isTransientDirectDbFailure(error)) {
      return NextResponse.json(
        {
          ok: false,
          retryable: true,
          error: 'Тимчасовий збій бази даних. Спробуйте повторити запит.',
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
