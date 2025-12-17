// web/app/api/admin/direct/statuses/[id]/route.ts
// API endpoint для роботи з окремим Direct статусом

import { NextRequest, NextResponse } from 'next/server';
import { getDirectStatus, saveDirectStatus, deleteDirectStatus, getAllDirectStatuses } from '@/lib/direct-store';

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
 * GET - отримати статус за ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const status = await getDirectStatus(params.id);
    if (!status) {
      return NextResponse.json({ ok: false, error: 'Status not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    console.error(`[direct/statuses/${params.id}] GET error:`, error);
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
 * PATCH - оновити статус
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const status = await getDirectStatus(params.id);
    if (!status) {
      return NextResponse.json({ ok: false, error: 'Status not found' }, { status: 404 });
    }

    const body = await req.json();
    const { name, color, order, isDefault } = body;

    // Перевіряємо, чи не існує вже статус з такою назвою (крім поточного)
    if (name) {
      const existing = await getAllDirectStatuses();
      const duplicate = existing.find(
        (s) => s.id !== params.id && s.name.toLowerCase() === name.toLowerCase()
      );
      if (duplicate) {
        return NextResponse.json(
          { ok: false, error: 'Status with this name already exists' },
          { status: 409 }
        );
      }
    }

    // Якщо встановлюємо isDefault = true, знімаємо з інших
    if (isDefault === true) {
      const existing = await getAllDirectStatuses();
      for (const s of existing) {
        if (s.id !== params.id && s.isDefault) {
          await saveDirectStatus({ ...s, isDefault: false });
        }
      }
    }

    const updated = {
      ...status,
      ...(name !== undefined && { name: name.trim() }),
      ...(color !== undefined && { color: color.trim() }),
      ...(order !== undefined && { order }),
      ...(isDefault !== undefined && { isDefault }),
    };

    await saveDirectStatus(updated);
    return NextResponse.json({ ok: true, status: updated });
  } catch (error) {
    console.error(`[direct/statuses/${params.id}] PATCH error:`, error);
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
 * DELETE - видалити статус
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const status = await getDirectStatus(params.id);
    if (!status) {
      return NextResponse.json({ ok: false, error: 'Status not found' }, { status: 404 });
    }

    // Перевіряємо, чи використовується статус
    const { getAllDirectClients } = await import('@/lib/direct-store');
    const clients = await getAllDirectClients();
    const isUsed = clients.some((c) => c.statusId === params.id);

    if (isUsed) {
      return NextResponse.json(
        { ok: false, error: 'Cannot delete status that is in use' },
        { status: 409 }
      );
    }

    await deleteDirectStatus(params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[direct/statuses/${params.id}] DELETE error:`, error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
