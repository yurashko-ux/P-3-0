// web/app/api/admin/direct/clients/route.ts
// API endpoint для роботи з Direct клієнтами

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient, getAllDirectStatuses } from '@/lib/direct-store';
import type { DirectClient } from '@/lib/direct-types';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  // Перевірка через ADMIN_PASS (кука)
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  // Перевірка через CRON_SECRET
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  // Якщо нічого не налаштовано, дозволяємо (для розробки)
  if (!ADMIN_PASS && !CRON_SECRET) return true;

  return false;
}

/**
 * GET - отримати список клієнтів з фільтрами та сортуванням
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = req.nextUrl;
    const statusId = searchParams.get('statusId');
    const masterId = searchParams.get('masterId');
    const source = searchParams.get('source');
    const sortBy = searchParams.get('sortBy') || 'firstContactDate';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    console.log('[direct/clients] GET: Fetching all clients...');
    let clients = await getAllDirectClients();
    console.log(`[direct/clients] GET: Retrieved ${clients.length} clients from getAllDirectClients()`);

    // Завантажуємо статуси для сортування по назві
    const statuses = await getAllDirectStatuses();
    const statusMap = new Map(statuses.map(s => [s.id, s.name]));

    // Завантажуємо майстрів для сортування по імені (якщо потрібно)
    let masterMap = new Map<string, string>();
    if (sortBy === 'masterId') {
      try {
        const masters = getMasters();
        masterMap = new Map(masters.map((m: any) => [m.id, m.name || '']));
      } catch (err) {
        console.warn('[direct/clients] Failed to load masters for sorting:', err);
      }
    }

    // Фільтрація
    if (statusId) {
      clients = clients.filter((c) => c.statusId === statusId);
    }
    if (masterId) {
      clients = clients.filter((c) => c.masterId === masterId);
    }
    if (source) {
      clients = clients.filter((c) => c.source === source);
    }

    // Сортування
    clients.sort((a, b) => {
      let aVal: any = a[sortBy as keyof DirectClient];
      let bVal: any = b[sortBy as keyof DirectClient];

      // Спеціальна обробка для статусів - сортуємо по назві
      if (sortBy === 'statusId') {
        aVal = statusMap.get(a.statusId) || '';
        bVal = statusMap.get(b.statusId) || '';
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }
      // Спеціальна обробка для майстрів - сортуємо по імені
      else if (sortBy === 'masterId') {
        aVal = masterMap.get(a.masterId || '') || a.masterId || '';
        bVal = masterMap.get(b.masterId || '') || b.masterId || '';
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
      }
      // Обробка дат
      else if (sortBy.includes('Date') || sortBy === 'firstContactDate' || sortBy === 'consultationDate' || sortBy === 'visitDate' || sortBy === 'paidServiceDate') {
        aVal = aVal ? new Date(aVal).getTime() : 0;
        bVal = bVal ? new Date(bVal).getTime() : 0;
      }
      // Обробка boolean
      else if (sortBy === 'visitedSalon' || sortBy === 'signedUpForPaidService') {
        aVal = aVal ? 1 : 0;
        bVal = bVal ? 1 : 0;
      }
      // Обробка рядків (для порожніх значень)
      else if (typeof aVal === 'string' || typeof bVal === 'string') {
        aVal = aVal || '';
        bVal = bVal || '';
        // Сортування без урахування регістру
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }
      // Обробка порожніх значень
      else {
        aVal = aVal ?? '';
        bVal = bVal ?? '';
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });

    console.log(`[direct/clients] GET: Returning ${clients.length} clients after filtering and sorting`);
    return NextResponse.json({ ok: true, clients, debug: { totalBeforeFilter: clients.length } });
  } catch (error) {
    console.error('[direct/clients] GET error:', error);
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
 * POST - створити нового клієнта
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      instagramUsername,
      firstName,
      lastName,
      source = 'instagram',
      statusId,
      masterId,
      consultationDate,
      comment,
    } = body;

    if (!instagramUsername) {
      return NextResponse.json(
        { ok: false, error: 'Instagram username is required' },
        { status: 400 }
      );
    }

    // Перевіряємо, чи не існує вже клієнт з таким username
    const existing = await getAllDirectClients();
    const duplicate = existing.find(
      (c) => c.instagramUsername.toLowerCase() === instagramUsername.toLowerCase()
    );
    if (duplicate) {
      return NextResponse.json(
        { ok: false, error: 'Client with this Instagram username already exists', clientId: duplicate.id },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const client: DirectClient = {
      id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      instagramUsername: instagramUsername.trim(),
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      source: source as 'instagram' | 'tiktok' | 'other',
      firstContactDate: now,
      statusId: statusId || 'new', // За замовчуванням "Новий"
      masterId: masterId,
      consultationDate: consultationDate,
      visitedSalon: false,
      signedUpForPaidService: false,
      signupAdmin: undefined,
      comment: comment?.trim(),
      createdAt: now,
      updatedAt: now,
    };

    await saveDirectClient(client);

    return NextResponse.json({ ok: true, client });
  } catch (error) {
    console.error('[direct/clients] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
