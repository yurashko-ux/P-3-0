// web/app/api/admin/direct/clients/[id]/route.ts
// API endpoint для роботи з окремим Direct клієнтом

import { NextRequest, NextResponse } from 'next/server';
import { getDirectClient, saveDirectClient, deleteDirectClient, getDirectStatus } from '@/lib/direct-store';
import type { DirectClient } from '@/lib/direct-types';

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
    const client = await getDirectClient(id);
    if (!client) {
      console.warn(`[direct/clients] Client not found for id="${id}"`);
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }

    const body = await req.json();
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
      instagramUsername: client.instagramUsername, // Не дозволяємо змінювати username
      createdAt: client.createdAt, // Не дозволяємо змінювати дату створення
      // НЕ рухаємо updatedAt від ручних правок в UI (щоб таблиця не "пливла").
      updatedAt: client.updatedAt,
    };

    await saveDirectClient(updated, 'ui-patch-client', { clientId: client.id }, { touchUpdatedAt: false });
    return NextResponse.json({ ok: true, client: updated });
  } catch (error) {
    const { id } = await resolveParams(params).catch(() => ({ id: 'unknown' }));
    console.error(`[direct/clients/${id}] PATCH error:`, error);
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
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
