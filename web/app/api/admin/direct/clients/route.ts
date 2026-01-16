// web/app/api/admin/direct/clients/route.ts
// API endpoint для роботи з Direct клієнтами

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient, getAllDirectStatuses } from '@/lib/direct-store';
import { getMasters } from '@/lib/photo-reports/service';
import { getLast5StatesForClients } from '@/lib/direct-state-log';
import type { DirectClient } from '@/lib/direct-types';
import { kvRead } from '@/lib/kv';
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  kyivDayFromISO,
  isAdminStaffName,
  pickNonAdminStaffFromGroup,
} from '@/lib/altegio/records-grouping';

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
    const hasAppointment = searchParams.get('hasAppointment');
    const sortBy = searchParams.get('sortBy') || 'firstContactDate';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    console.log('[direct/clients] GET: Fetching all clients...');
    let clients: DirectClient[] = [];
    try {
      clients = await getAllDirectClients();
      console.log(`[direct/clients] GET: Retrieved ${clients.length} clients from getAllDirectClients()`);
      if (clients.length === 0) {
        console.warn('[direct/clients] GET: WARNING - getAllDirectClients() returned empty array!');
        // Перевіряємо, чи взагалі є клієнти в базі через прямий SQL запит
        try {
          const { prisma } = await import('@/lib/prisma');
          const count = await prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(*) as count FROM "direct_clients"
          `;
          const totalCount = Number(count[0]?.count || 0);
          console.log(`[direct/clients] GET: Direct SQL count query returned: ${totalCount} clients in database`);
          if (totalCount > 0) {
            console.error('[direct/clients] GET: ERROR - Database has clients but getAllDirectClients() returned empty!');
          }
        } catch (countErr) {
          console.error('[direct/clients] GET: Failed to check database count:', countErr);
        }
      }
    } catch (fetchErr) {
      console.error('[direct/clients] GET: Error fetching clients:', fetchErr);
      console.error('[direct/clients] GET: Error details:', {
        message: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
        stack: fetchErr instanceof Error ? fetchErr.stack : undefined,
      });
      // Повертаємо порожній масив замість помилки, щоб не ламати UI
      return NextResponse.json({ 
        ok: true, 
        clients: [], 
        error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
        warning: 'Failed to fetch clients from database'
      });
    }

    // Завантажуємо статуси для сортування по назві
    const statuses = await getAllDirectStatuses();
    const statusMap = new Map(statuses.map(s => [s.id, s.name]));

    // DirectMaster: потрібен для фільтра "Майстер" (тепер це serviceMasterName) і для атрибуції перезаписів
    let directMasterIdToName = new Map<string, string>();
    let directMasterNameToId = new Map<string, string>();
    let directMasterIdToStaffId = new Map<string, number>();
    try {
      const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
      const dms = await getAllDirectMasters();
      directMasterIdToName = new Map(dms.map((m: any) => [m.id, (m.name || '').toString()]));
      directMasterNameToId = new Map(
        dms.map((m: any) => [(m.name || '').toString().trim().toLowerCase(), m.id])
      );
      directMasterIdToStaffId = new Map(
        dms
          .filter((m: any) => typeof m.altegioStaffId === 'number')
          .map((m: any) => [m.id, m.altegioStaffId as number])
      );
    } catch (err) {
      console.warn('[direct/clients] ⚠️ Не вдалося завантажити DirectMaster (фільтр/перезапис):', err);
    }

    // Завантажуємо відповідальних для сортування по імені (якщо потрібно)
    let masterMap = new Map<string, string>();
    if (sortBy === 'masterId') {
      try {
        const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
        const masters = await getAllDirectMasters();
        masterMap = new Map(masters.map((m: any) => [m.id, m.name || '']));
      } catch (err) {
        console.warn('[direct/clients] Failed to load masters for sorting:', err);
        // Fallback на старий метод
        try {
          const { getMasters } = await import('@/lib/photo-reports/service');
          const masters = getMasters();
          masterMap = new Map(masters.map((m: any) => [m.id, m.name || '']));
        } catch (fallbackErr) {
          console.warn('[direct/clients] Fallback to old masters also failed:', fallbackErr);
        }
      }
    }

    // Фільтрація
    if (statusId) {
      clients = clients.filter((c) => c.statusId === statusId);
    }
    if (masterId) {
      const selectedMasterName = (directMasterIdToName.get(masterId) || '').trim().toLowerCase();
      const selectedMasterFirst = selectedMasterName ? selectedMasterName.split(/\s+/)[0] : '';
      const selectedStaffId = directMasterIdToStaffId.get(masterId) ?? null;

      clients = clients.filter((c) => {
        // 1) точний матч по staffId (найнадійніше)
        if (selectedStaffId && (c.serviceMasterAltegioStaffId ?? null) === selectedStaffId) return true;

        // 2) фолбек: коли в DirectMaster тільки ім'я, а в Altegio ПІБ
        const cm = (c.serviceMasterName || '').trim().toLowerCase();
        if (!cm) return false;
        if (selectedMasterName && cm === selectedMasterName) return true;
        const clientFirst = cm.split(/\s+/)[0] || '';
        if (selectedMasterFirst && clientFirst === selectedMasterFirst) return true;
        return false;
      });
    }
    if (source) {
      clients = clients.filter((c) => c.source === source);
    }
    if (hasAppointment === 'true') {
      // Фільтруємо клієнтів з активною датою запису
      clients = clients.filter((c) => {
        return c.paidServiceDate && c.paidServiceDate.trim() !== '';
      });
    }

    // Діагностика для "Юлія Кобра" та "Топоріна Олена"
    const debugClients = clients.filter(c => 
      c.instagramUsername === 'kobra_best' || 
      c.instagramUsername === 'olena_toporina'
    );
    if (debugClients.length > 0) {
      console.log('[direct/clients] 🔍 Діагностика для API:', debugClients.map(c => ({
        instagramUsername: c.instagramUsername,
        isOnlineConsultation: c.isOnlineConsultation,
        consultationBookingDate: c.consultationBookingDate,
        paidServiceDate: c.paidServiceDate,
      })));
    }

    // Обчислюємо прапори "Перезапис" (🔁) для клієнтів, які мають Altegio ID і paidServiceDate.
    // Умови:
    // - поточний paid запис (той що показуємо) був створений в день attended paid-візиту (Europe/Kyiv)
    // - атрибуція: майстер = перший receivedAt у attended-групі (exclude admin/unknown)
    try {
      const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
      const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
      const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
      const groupsByClient = groupRecordsByClientDay(normalizedEvents);

      clients = clients.map((c) => {
        // Дораховуємо "хто консультував" для UI (щоб не чекати cron), якщо є дата консультації.
        // Правило:
        // - беремо consultation-групу на kyivDay консультації
        // - показуємо останнього МАЙСТРА (не-адміна) за receivedAt
        // - якщо майстра нема — fallback на адміна
        // - якщо немає жодного staffName — лишаємо як є (UI покаже "невідомо")
        try {
          if (c.altegioClientId && c.consultationBookingDate) {
            const groups = groupsByClient.get(c.altegioClientId) || [];
            const consultDay = kyivDayFromISO(c.consultationBookingDate);
            const consultGroup =
              consultDay
                ? (groups.find((g: any) => (g?.groupType === 'consultation') && (g?.kyivDay || '') === consultDay) || null)
                : null;

            if (consultGroup) {
              const events = Array.isArray((consultGroup as any).events) ? (consultGroup as any).events : [];
              const sorted = [...events].sort((a: any, b: any) => {
                const ta = new Date(b?.receivedAt || b?.datetime || 0).getTime();
                const tb = new Date(a?.receivedAt || a?.datetime || 0).getTime();
                return ta - tb;
              });

              const isKnownName = (ev: any) => {
                const name = (ev?.staffName || '').toString().trim();
                if (!name) return false;
                if (name.toLowerCase().includes('невідом')) return false;
                return true;
              };

              const lastNonAdmin = sorted.find((ev: any) => isKnownName(ev) && !isAdminStaffName((ev.staffName || '').toString()));
              const lastAdmin = sorted.find((ev: any) => isKnownName(ev) && isAdminStaffName((ev.staffName || '').toString()));
              const chosen = lastNonAdmin || lastAdmin || null;

              if (chosen?.staffName) {
                const current = (c.consultationMasterName || '').toString().trim();
                const shouldReplace = !current || isAdminStaffName(current);
                if (shouldReplace) {
                  c = { ...c, consultationMasterName: String(chosen.staffName) };
                }
              }
            }
          }
        } catch (err) {
          console.warn('[direct/clients] ⚠️ Не вдалося дорахувати consultationMasterName (не критично):', err);
        }

        if (!c.altegioClientId || !c.paidServiceDate) return c;
        const groups = groupsByClient.get(c.altegioClientId) || [];
        if (!groups.length) return c;

        const paidGroups = groups.filter((g: any) => g?.groupType === 'paid');
        if (!paidGroups.length) return c;

        const paidKyivDay = kyivDayFromISO(c.paidServiceDate);
        if (!paidKyivDay) return c;

        const currentGroup = paidGroups.find((g: any) => (g?.kyivDay || '') === paidKyivDay) || null;
        if (!currentGroup) return c;

        const events = Array.isArray(currentGroup.events) ? currentGroup.events : [];
        const createEvents = events
          .filter((e: any) => (e?.status || '').toString().toLowerCase() === 'create' && e?.receivedAt)
          .sort((a: any, b: any) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
        const createdKyivDay = createEvents.length ? kyivDayFromISO(createEvents[0].receivedAt) : '';
        if (!createdKyivDay) return c;

        const attendedGroup =
          paidGroups.find(
            (g: any) =>
              (g?.kyivDay || '') === createdKyivDay && (g?.attendance === 1 || g?.attendanceStatus === 'arrived')
          ) || null;
        if (!attendedGroup) return c;

        const picked = pickNonAdminStaffFromGroup(attendedGroup, 'first');
        let pickedMasterId: string | undefined = undefined;
        if (picked?.staffId != null) {
          // Перевага: матч по altegioStaffId
          for (const [dmId, staffId] of directMasterIdToStaffId.entries()) {
            if (staffId === picked.staffId) {
              pickedMasterId = dmId;
              break;
            }
          }
        }
        if (!pickedMasterId && picked?.staffName) {
          const full = picked.staffName.trim().toLowerCase();
          pickedMasterId = directMasterNameToId.get(full);
          if (!pickedMasterId) {
            const first = full.split(/\s+/)[0] || '';
            pickedMasterId = first ? directMasterNameToId.get(first) : undefined;
          }
        }

        return {
          ...c,
          paidServiceIsRebooking: true,
          paidServiceRebookFromKyivDay: createdKyivDay,
          paidServiceRebookFromMasterName: picked?.staffName || undefined,
          paidServiceRebookFromMasterId: pickedMasterId,
        };
      });
    } catch (err) {
      console.warn('[direct/clients] ⚠️ Не вдалося обчислити "Перезапис" (не критично):', err);
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
        aVal = a.serviceMasterName || '';
        bVal = b.serviceMasterName || '';
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
      }
      // Обробка дат
      else if (sortBy.includes('Date') || sortBy === 'firstContactDate' || sortBy === 'consultationDate' || sortBy === 'visitDate' || sortBy === 'paidServiceDate' || sortBy === 'consultationBookingDate' || sortBy === 'updatedAt' || sortBy === 'createdAt') {
        aVal = aVal ? new Date(aVal).getTime() : 0;
        bVal = bVal ? new Date(bVal).getTime() : 0;
      }
      // Обробка boolean
      else if (sortBy === 'visitedSalon' || sortBy === 'signedUpForPaidService' || sortBy === 'consultationAttended' || sortBy === 'signedUpForPaidServiceAfterConsultation') {
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
    
    // Отримуємо останні 5 станів для всіх клієнтів одним оптимізованим запитом
    const clientIds = clients.map(c => c.id);
    let statesMap = new Map<string, any[]>();
    try {
      statesMap = await getLast5StatesForClients(clientIds);
      console.log(`[direct/clients] GET: Loaded state history for ${statesMap.size} clients`);
    } catch (statesErr) {
      console.warn('[direct/clients] GET: Failed to load state history (non-critical):', statesErr);
      // Продовжуємо без історії станів
    }
    
    // Додаємо останні 5 станів до кожного клієнта
    // getLast5StatesForClients вже відфільтрувала дублікати стану "client" та "lead"
    const clientsWithStates = clients.map(client => {
      const clientStates = statesMap.get(client.id) || [];
      
      return {
      ...client,
        last5States: clientStates,
      };
    });
    
    const response = { 
      ok: true, 
      clients: clientsWithStates, 
      debug: { 
        totalBeforeFilter: clients.length,
        filters: { statusId, masterId, source },
        sortBy,
        sortOrder,
      } 
    };
    console.log('[direct/clients] GET: Response summary:', {
      ok: response.ok,
      clientsCount: response.clients.length,
      filters: response.debug.filters,
    });
    return NextResponse.json(response);
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
