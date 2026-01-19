// web/app/api/admin/direct/clients/[id]/route.ts
// API endpoint для роботи з окремим Direct клієнтом

import { NextRequest, NextResponse } from 'next/server';
import { getDirectClient, saveDirectClient, deleteDirectClient } from '@/lib/direct-store';
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

/**
 * GET - отримати клієнта за ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = await getDirectClient(params.id);
    if (!client) {
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, client });
  } catch (error) {
    console.error(`[direct/clients/${params.id}] GET error:`, error);
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
  { params }: { params: { id: string } }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = await getDirectClient(params.id);
    if (!client) {
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }

    const body = await req.json();
    const updated: DirectClient = {
      ...client,
      ...body,
      id: client.id, // Не дозволяємо змінювати ID
      instagramUsername: client.instagramUsername, // Не дозволяємо змінювати username
      createdAt: client.createdAt, // Не дозволяємо змінювати дату створення
      // НЕ рухаємо updatedAt від ручних правок в UI (щоб таблиця не “пливла”).
      updatedAt: client.updatedAt,
    };

    await saveDirectClient(updated, 'ui-patch-client', { clientId: client.id }, { touchUpdatedAt: false });
    return NextResponse.json({ ok: true, client: updated });
  } catch (error) {
    console.error(`[direct/clients/${params.id}] PATCH error:`, error);
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
  { params }: { params: { id: string } }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = await getDirectClient(params.id);
    if (!client) {
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }

    await deleteDirectClient(params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[direct/clients/${params.id}] DELETE error:`, error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
