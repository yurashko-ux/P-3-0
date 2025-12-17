// web/app/api/admin/direct/statuses/route.ts
// API endpoint для роботи з Direct статусами

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectStatuses, saveDirectStatus } from '@/lib/direct-store';
import type { DirectStatus } from '@/lib/direct-types';

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
 * GET - отримати всі статуси
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const statuses = await getAllDirectStatuses();
    return NextResponse.json({ ok: true, statuses });
  } catch (error) {
    console.error('[direct/statuses] GET error:', error);
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
 * POST - створити новий статус
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, color, order, isDefault = false } = body;

    if (!name || !color) {
      return NextResponse.json(
        { ok: false, error: 'Name and color are required' },
        { status: 400 }
      );
    }

    // Перевіряємо, чи не існує вже статус з такою назвою
    const existing = await getAllDirectStatuses();
    const duplicate = existing.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      return NextResponse.json(
        { ok: false, error: 'Status with this name already exists' },
        { status: 409 }
      );
    }

    // Якщо це default статус, знімаємо isDefault з інших
    if (isDefault) {
      for (const status of existing) {
        if (status.isDefault) {
          await saveDirectStatus({ ...status, isDefault: false });
        }
      }
    }

    // Визначаємо order, якщо не вказано
    let statusOrder = order;
    if (statusOrder === undefined) {
      const maxOrder = existing.length > 0 ? Math.max(...existing.map((s) => s.order)) : 0;
      statusOrder = maxOrder + 1;
    }

    const now = new Date().toISOString();
    const status: DirectStatus = {
      id: `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: name.trim(),
      color: color.trim(),
      order: statusOrder,
      isDefault,
      createdAt: now,
    };

    await saveDirectStatus(status);
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    console.error('[direct/statuses] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
