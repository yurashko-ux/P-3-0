// web/app/api/admin/direct/clients/route.ts
// API endpoint для роботи з Direct клієнтами

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient, getAllDirectStatuses } from '@/lib/direct-store';
import { getMasters } from '@/lib/photo-reports/service';
import { getLast5StatesForClients } from '@/lib/direct-state-log';
import type { DirectClient } from '@/lib/direct-types';
import { kvRead } from '@/lib/kv';
import { prisma } from '@/lib/prisma';
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  kyivDayFromISO,
  isAdminStaffName,
  computeServicesTotalCostUAH,
  pickNonAdminStaffFromGroup,
  pickNonAdminStaffPairFromGroup,
  countNonAdminStaffInGroup,
  getPerMasterSumsFromGroup,
  getVisitIdAndRecordIdForBreakdown,
  pickRecordCreatedAtISOFromGroup,
} from '@/lib/altegio/records-grouping';
import { computePeriodStats } from '@/lib/direct-period-stats';

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
    const totalOnly = searchParams.get('totalOnly') === '1';
    const statsOnly = searchParams.get('statsOnly') === '1';
    const statusId = searchParams.get('statusId');
    const masterId = searchParams.get('masterId');
    const source = searchParams.get('source');
    const hasAppointment = searchParams.get('hasAppointment');
    const actMode = searchParams.get('actMode');
    const actYear = searchParams.get('actYear');
    const actMonth = searchParams.get('actMonth');
    const daysFilter = searchParams.get('days');
    const instFilter = searchParams.get('inst');
    const stateFilter = searchParams.get('state');
    const consultCreatedMode = searchParams.get('consultCreatedMode');
    const consultCreatedYear = searchParams.get('consultCreatedYear');
    const consultCreatedMonth = searchParams.get('consultCreatedMonth');
    const consultAppointedMode = searchParams.get('consultAppointedMode');
    const consultAppointedYear = searchParams.get('consultAppointedYear');
    const consultAppointedMonth = searchParams.get('consultAppointedMonth');
    const consultCreatedPreset = searchParams.get('consultCreatedPreset');
    const consultAppointedPreset = searchParams.get('consultAppointedPreset');
    const consultAttendance = searchParams.get('consultAttendance');
    const consultType = searchParams.get('consultType');
    const consultMasters = searchParams.get('consultMasters');
    const consultHasConsultation = searchParams.get('consultHasConsultation');
    const recordCreatedMode = searchParams.get('recordCreatedMode');
    const recordCreatedYear = searchParams.get('recordCreatedYear');
    const recordCreatedMonth = searchParams.get('recordCreatedMonth');
    const recordCreatedPreset = searchParams.get('recordCreatedPreset');
    const recordAppointedMode = searchParams.get('recordAppointedMode');
    const recordAppointedYear = searchParams.get('recordAppointedYear');
    const recordAppointedMonth = searchParams.get('recordAppointedMonth');
    const recordAppointedPreset = searchParams.get('recordAppointedPreset');
    const recordClient = searchParams.get('recordClient');
    const recordSum = searchParams.get('recordSum');
    const recordHasRecord = searchParams.get('recordHasRecord');
    const recordNewClient = searchParams.get('recordNewClient');
    const masterHands = searchParams.get('masterHands');
    const masterPrimary = searchParams.get('masterPrimary');
    const masterSecondary = searchParams.get('masterSecondary');
    let sortBy = searchParams.get('sortBy') || 'updatedAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    // Старі поля (дублювались в UI). Сортування по них більше не підтримуємо.
    // Payload лишаємо без змін, але sortBy примусово переводимо на updatedAt.
    const legacySortBy = new Set([
      'signedUpForPaidServiceAfterConsultation',
      'visitedSalon',
      'visitDate',
      'signedUpForPaidService',
      'signupAdmin',
    ]);
    if (legacySortBy.has(sortBy)) {
      console.warn(
        `[direct/clients] ⚠️ Отримано застарілий sortBy="${sortBy}". Використовую fallback: sortBy="updatedAt".`
      );
      sortBy = 'updatedAt';
    }

    console.log('[direct/clients] GET: Fetching all clients...');
    let clients: DirectClient[] = [];
    let totalCount = 0;
    try {
      clients = await getAllDirectClients();
      console.log(`[direct/clients] GET: Retrieved ${clients.length} clients from getAllDirectClients()`);
      // Те саме джерело для обох екранів: totalCount = довжина списку getAllDirectClients().
      totalCount = clients.length;

      // Єдине джерело для "кількість клієнтів": Статистика фетчить ?totalOnly=1 і показує той самий totalCount.
      if (totalOnly) {
        return NextResponse.json({ ok: true, totalCount });
      }

      // #region agent log
      const withLastVisitAt = clients.filter(c => !!(c as any).lastVisitAt);
      const withAltegioId = clients.filter(c => !!c.altegioClientId);
      const withAltegioButNoLastVisit = clients.filter(c => !!c.altegioClientId && !(c as any).lastVisitAt);
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'clients/route.ts:80',message:'Clients loaded from database',data:{total:clients.length,withLastVisitAt:withLastVisitAt.length,withAltegioId:withAltegioId.length,withAltegioButNoLastVisit:withAltegioButNoLastVisit.length,sampleClients:clients.slice(0,5).map(c=>({id:c.id,hasLastVisitAt:!!(c as any).lastVisitAt,lastVisitAt:(c as any).lastVisitAt,hasAltegioClientId:!!c.altegioClientId,altegioClientId:c.altegioClientId}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      try {
        const withAltegio = clients.filter((c) => !!c.altegioClientId);
        const withAltegioNoName = withAltegio.filter((c) => !(c.firstName && c.firstName.trim()) && !(c.lastName && c.lastName.trim()));
        const withAltegioSourceInstagram = withAltegio.filter((c) => c.source === 'instagram').length;
      } catch {}
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
    // Мапа для перевірки, чи майстер є адміністратором (за ім'ям)
    let masterNameToRole = new Map<string, 'master' | 'direct-manager' | 'admin'>();
    if (sortBy === 'masterId') {
      try {
        const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
        const masters = await getAllDirectMasters();
        masterMap = new Map(masters.map((m: any) => [m.id, m.name || '']));
        // Створюємо мапу ім'я -> роль для перевірки адміністраторів
        masterNameToRole = new Map(masters.map((m: any) => [m.name?.toLowerCase().trim() || '', m.role || 'master']));
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
    } else {
      // Завантажуємо майстрів для перевірки ролей (навіть якщо не сортуємо)
      try {
        const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
        const masters = await getAllDirectMasters();
        masterNameToRole = new Map(masters.map((m: any) => [m.name?.toLowerCase().trim() || '', m.role || 'master']));
      } catch (err) {
        console.warn('[direct/clients] Failed to load masters for role check:', err);
      }
    }
    
    // Допоміжна функція для перевірки, чи майстер є адміністратором (перевіряє і роль в БД)
    const isAdminByName = (name: string | null | undefined): boolean => {
      if (!name) return false;
      const n = name.toLowerCase().trim();
      // Спочатку перевіряємо за ім'ям (якщо містить "адм")
      if (isAdminStaffName(n)) return true;
      // Потім перевіряємо роль в базі даних
      const role = masterNameToRole.get(n);
      return role === 'admin' || role === 'direct-manager';
    };

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

    // Фільтрація за clientType (AND логіка: клієнт має відповідати ВСІМ вибраним типам)
    const clientType = searchParams.get('clientType');
    if (clientType) {
      const types = clientType.split(',').filter(Boolean);
      if (types.length > 0) {
        clients = clients.filter((c) => {
          const matches: boolean[] = [];
          
          // Перевіряємо кожен вибраний фільтр
          for (const filterType of types) {
            if (filterType === 'leads') {
              matches.push(!c.altegioClientId);
            } else if (filterType === 'clients') {
              matches.push(!!c.altegioClientId);
            } else if (filterType === 'consulted') {
              matches.push(!!c.altegioClientId && (c.spent ?? 0) === 0);
            } else if (filterType === 'good') {
              const spent = c.spent ?? 0;
              matches.push(spent < 100000 && spent > 0);
            } else if (filterType === 'stars') {
              matches.push((c.spent ?? 0) >= 100000);
            }
          }

          // AND логіка: клієнт має відповідати ВСІМ вибраним типам
          return matches.length === types.length && matches.every((m) => m === true);
        });
        console.log(`[direct/clients] Filtered by clientType: ${types.join(',')}, remaining: ${clients.length}`);
      }
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
        // Дораховуємо "поточний Майстер" для UI з KV (щоб збігалось з модалкою "Webhook-и").
        // Бізнес-правило для колонки "Майстер": ігноруємо адмінів/невідомих, пріоритет = paid-запис (якщо він є).
        try {
          if (c.altegioClientId) {
            const groups = groupsByClient.get(c.altegioClientId) || [];
            // Якщо в БД немає consultationBookingDate, але в KV є consultation-group з датою —
            // підставляємо дату в ВІДПОВІДЬ (без запису в БД), щоб таблиця показувала запис.
            // Правило вибору:
            // - беремо consultation-group з валідним datetime
            // - пріоритет: найближча майбутня (або найближча в межах 14 днів)
            // - додатково: консультації сьогодні (kyivDay === todayKyiv), навіть якщо вже минули — для KPI «Заплановано»
            // - якщо майбутніх і сьогоднішніх нема — не чіпаємо (не підставляємо заднім числом)
            if (!c.consultationBookingDate) {
              try {
                const consultGroups = groups.filter((g: any) => g?.groupType === 'consultation');
                const nowTs = Date.now();
                const todayKyiv = kyivDayFromISO(new Date().toISOString());
                const maxFutureMs = 14 * 24 * 60 * 60 * 1000;
                let best: any = null;
                let bestTs = Infinity;
                for (const g of consultGroups) {
                  const dt = (g as any)?.datetime || (g as any)?.receivedAt || null;
                  if (!dt) continue;
                  const ts = new Date(dt).getTime();
                  if (!isFinite(ts)) continue;
                  const diff = ts - nowTs;
                  const groupDay = kyivDayFromISO(dt);
                  // приймаємо: майбутні в межах 14 днів, АБО консультації сьогодні (включно з уже минулими)
                  const isFutureWithin14Days = diff >= 0 && diff <= maxFutureMs;
                  const isToday = !!groupDay && groupDay === todayKyiv;
                  if (!isFutureWithin14Days && !isToday) continue;
                  if (ts < bestTs) {
                    bestTs = ts;
                    best = g;
                  }
                }

                if (best && isFinite(bestTs)) {
                  const iso = new Date(bestTs).toISOString();
                  c = { ...c, consultationBookingDate: iso };
                }
              } catch {}
            }

            // Номер спроби консультації: 2/3/… (збільшуємо ТІЛЬКИ після no-show).
            // Правило: для поточної consultationBookingDate номер = 1 + кількість no-show консультацій ДО цієї дати (Europe/Kyiv).
            // Переноси ДО дати (без no-show) не збільшують.
            try {
              if (c.consultationBookingDate) {
                const currentDay = kyivDayFromISO(String(c.consultationBookingDate));
                if (currentDay) {
                  const noShowBefore = groups.filter((g: any) => {
                    if (!g || g.groupType !== 'consultation') return false;
                    const day = (g.kyivDay || '').toString();
                    if (!day) return false;
                    if (day >= currentDay) return false; // тільки ДО поточної дати
                    // no-show = attendanceStatus 'no-show' (cancelled окремо) або attendance === -1
                    const status = (g.attendanceStatus || '').toString();
                    const att = (g.attendance ?? null) as any;
                    return status === 'no-show' || att === -1;
                  }).length;

                  const attemptNumber = 1 + noShowBefore;
                  if (attemptNumber >= 2) {
                    c = { ...c, consultationAttemptNumber: attemptNumber };
                  } else {
                    c = { ...c, consultationAttemptNumber: undefined };
                  }
                } else {
                  c = { ...c, consultationAttemptNumber: undefined };
                }
              } else {
                c = { ...c, consultationAttemptNumber: undefined };
              }
            } catch (err) {
              console.warn('[direct/clients] ⚠️ Не вдалося порахувати consultationAttemptNumber:', err);
            }

            const pickClosestGroup = (groupType: 'paid' | 'consultation', targetISO: string) => {
              const targetTs = new Date(targetISO).getTime();
              if (!isFinite(targetTs)) return null;
              const targetDay = kyivDayFromISO(targetISO);
              const sameDay = targetDay
                ? (groups.find((g: any) => (g?.groupType === groupType) && (g?.kyivDay || '') === targetDay) || null)
                : null;
              if (sameDay) return sameDay;

              let best: any = null;
              let bestDiff = Infinity;
              for (const g of groups) {
                if ((g as any)?.groupType !== groupType) continue;
                const dt = (g as any)?.datetime || (g as any)?.receivedAt || null;
                if (!dt) continue;
                const ts = new Date(dt).getTime();
                if (!isFinite(ts)) continue;
                const diff = Math.abs(ts - targetTs);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  best = g;
                }
              }
              // Фолбек тільки якщо це справді той самий запис (до 24 год різниці)
              if (best && bestDiff <= 24 * 60 * 60 * 1000) return best;
              return null;
            };

            // ВАЖЛИВО (оновлене правило): "Майстер" — ТІЛЬКИ для платних записів.
            // Якщо в клієнта немає paidServiceDate — в UI робимо колонку порожньою, навіть якщо в БД щось залишилось.
            if (!c.paidServiceDate) {
              c = {
                ...c,
                serviceMasterName: undefined,
                serviceMasterAltegioStaffId: null,
                serviceSecondaryMasterName: undefined,
              };
            } else {
              const paidGroup = pickClosestGroup('paid', c.paidServiceDate);
              const chosen = paidGroup;
              const paidRecordCreatedAt = pickRecordCreatedAtISOFromGroup(chosen);
              if (paidRecordCreatedAt) {
                c = { ...c, paidServiceRecordCreatedAt: paidRecordCreatedAt };
              } else {
                c = { ...c, paidServiceRecordCreatedAt: undefined };
              }
              if (chosen) {
                const pair = pickNonAdminStaffPairFromGroup(chosen as any, 'first');
                // Додаткова перевірка: фільтруємо адміністраторів за роллю в БД
                const filteredPair = pair.filter(p => {
                  if (!p.staffName) return false;
                  return !isAdminByName(p.staffName);
                });
                const primary = filteredPair[0] || null;
                const secondary = filteredPair[1] || null;
                if (primary?.staffName) {
                  // Якщо майстер уже заданий в БД (і це не адмін/пусто) — не перетираємо.
                  // Це дозволяє точково виправляти 1-2 кейси без “авто-переобчислення” з KV.
                  const currentName = (c.serviceMasterName || '').toString().trim();
                  const shouldReplace = !currentName || isAdminByName(currentName);
                  if (!shouldReplace) {
                    // залишаємо як є, але вторинного майстра можемо дорахувати (не критично)
                    c = {
                      ...c,
                      serviceSecondaryMasterName: secondary?.staffName ? String(secondary.staffName) : c.serviceSecondaryMasterName,
                    };
                  } else {
                  c = {
                    ...c,
                    serviceMasterName: String(primary.staffName),
                    serviceMasterAltegioStaffId: primary.staffId ?? null,
                    serviceSecondaryMasterName: secondary?.staffName ? String(secondary.staffName) : undefined,
                  };
                  }
                } else {
                  // Якщо після фільтрації не залишилося майстрів - очищаємо serviceMasterName
                  // (не встановлюємо адміністратора як fallback)
                  c = {
                    ...c,
                    serviceMasterName: undefined,
                    serviceMasterAltegioStaffId: null,
                    serviceSecondaryMasterName: undefined,
                  };
                }
              }
              const handsCnt = chosen ? countNonAdminStaffInGroup(chosen as any) : 0;
              const hands = chosen ? (handsCnt <= 1 ? 2 : handsCnt === 2 ? 4 : 6) as 2 | 4 | 6 : undefined;
              c = { ...c, paidServiceHands: hands };
              // Розбиття сум по майстрах: пріоритет — breakdown з БД (з API за visit_id); fallback — KV
              const dbBreakdown = (c as any).paidServiceVisitBreakdown as { masterName: string; sumUAH: number }[] | undefined;
              if (Array.isArray(dbBreakdown) && dbBreakdown.length > 0) {
                c = { ...c, paidServiceMastersBreakdown: dbBreakdown } as typeof c & { paidServiceMastersBreakdown: { masterName: string; sumUAH: number }[] };
              } else if (chosen) {
                const targetSum = typeof (c as any).paidServiceTotalCost === 'number' ? (c as any).paidServiceTotalCost : null;
                const { visitId: mainVisitId, recordId: mainRecordId } = getVisitIdAndRecordIdForBreakdown(chosen as any, targetSum ?? undefined);
                const breakdown = getPerMasterSumsFromGroup(chosen as any, mainVisitId ?? undefined, mainRecordId ?? undefined);
                if (breakdown.length > 0) {
                  c = { ...c, paidServiceMastersBreakdown: breakdown } as typeof c & { paidServiceMastersBreakdown: { masterName: string; sumUAH: number }[] };
                }
              }
            }
            
            // ВАЖЛИВО: Фільтруємо адміністраторів з serviceMasterName, навіть якщо вони вже є в БД
            // Це очищає існуючі дані, де адміністратори (наприклад, Вікторія) були встановлені раніше
            if (c.serviceMasterName) {
              const currentMasterName = (c.serviceMasterName || '').toString().trim();
              if (currentMasterName && isAdminByName(currentMasterName)) {
                // Очищаємо serviceMasterName, якщо це адміністратор
                c = {
                  ...c,
                  serviceMasterName: undefined,
                  serviceMasterAltegioStaffId: null,
                };
              }
            }
          }
        } catch (err) {
          console.warn('[direct/clients] ⚠️ Не вдалося дорахувати serviceMasterName з KV (не критично):', err);
        }

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

            // ВАЖЛИВО: attendance в UI має відповідати KV-групі того ДНЯ, який показуємо.
            // Тому для відповіді /clients ми пріоритезуємо KV-групу (як у модалці "Webhook-и"),
            // але НЕ перетираємо true на false.
            const pickClosestConsultGroup = () => {
              if (consultGroup) return consultGroup;
              if (!groups.length) return null;
              const bookingTs = new Date(c.consultationBookingDate as any).getTime();
              if (!isFinite(bookingTs)) return null;
              let best: any = null;
              let bestDiff = Infinity;
              for (const g of groups) {
                if ((g as any)?.groupType !== 'consultation') continue;
                const dt = (g as any)?.datetime || (g as any)?.receivedAt || null;
                if (!dt) continue;
                const ts = new Date(dt).getTime();
                if (!isFinite(ts)) continue;
                const diff = Math.abs(ts - bookingTs);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  best = g;
                }
              }
              // фолбек тільки якщо дуже близько (до 24 год)
              if (best && bestDiff <= 24 * 60 * 60 * 1000) return best;
              return null;
            };

            // Дата створення запису (для tooltip у таблиці): беремо earliest "create" з KV-івентів по цій даті.
            try {
              const chosenConsult = pickClosestConsultGroup();
              const consultRecordCreatedAt = pickRecordCreatedAtISOFromGroup(chosenConsult);
              if (consultRecordCreatedAt) {
                c = { ...c, consultationRecordCreatedAt: consultRecordCreatedAt };
              } else {
                c = { ...c, consultationRecordCreatedAt: undefined };
              }
            } catch {
              c = { ...c, consultationRecordCreatedAt: undefined };
            }

            const cg = pickClosestConsultGroup();
            if (cg) {
              const attStatus = String((cg as any).attendanceStatus || '');
              // ВАЖЛИВО: Оновлюємо attendance тільки якщо в KV є чіткий статус (arrived/no-show/cancelled)
              // Якщо статус 'pending' або невідомо - зберігаємо значення з БД (не скидаємо до null)
              if (attStatus === 'arrived' || (cg as any).attendance === 1) {
                c = { ...c, consultationAttended: true, consultationCancelled: false };
              } else if (attStatus === 'no-show' || (cg as any).attendance === -1) {
                // Встановлюємо false тільки якщо в БД ще не встановлено true
                if ((c as any).consultationAttended !== true) {
                  c = { ...c, consultationAttended: false, consultationCancelled: false };
                }
              } else if (attStatus === 'cancelled' || (cg as any).attendance === -2) {
                // Встановлюємо null тільки якщо в БД ще не встановлено true
                if ((c as any).consultationAttended !== true) {
                  c = { ...c, consultationAttended: null, consultationCancelled: true };
                } else {
                  c = { ...c, consultationCancelled: false };
                }
              }
              // Якщо статус 'pending' або невідомо - НЕ змінюємо значення з БД
              // Це дозволяє зберегти встановлені раніше значення, навіть якщо в KV storage немає даних
            }
            // Якщо групу не знайдено - також НЕ змінюємо значення з БД
            // Це дозволяє зберегти встановлені раніше значення для старих записів

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

              // ВАЖЛИВО: не використовуємо адміністраторів як fallback
              // Якщо немає не-адміністраторів - не встановлюємо consultationMasterName
              const lastNonAdmin = sorted.find((ev: any) => isKnownName(ev) && !isAdminByName((ev.staffName || '').toString()));
              const chosen = lastNonAdmin || null;

              if (chosen?.staffName) {
                const current = (c.consultationMasterName || '').toString().trim();
                const shouldReplace = !current || isAdminByName(current);
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

        // Attendance для "Запис" має відповідати KV-групі цього дня.
        // ВАЖЛИВО: Оновлюємо attendance тільки якщо в KV є чіткий статус (arrived/no-show/cancelled)
        // Якщо статус 'pending' або невідомо - зберігаємо значення з БД (не скидаємо до null)
        try {
          const attStatus = String((currentGroup as any).attendanceStatus || '');
          const attVal = (currentGroup as any).attendance ?? null;
          if (attStatus === 'arrived' || attVal === 1) {
            c = { ...c, paidServiceAttended: true, paidServiceCancelled: false };
          } else if (attStatus === 'no-show' || attVal === -1) {
            // Встановлюємо false тільки якщо в БД ще не встановлено true
            if ((c as any).paidServiceAttended !== true) {
              c = { ...c, paidServiceAttended: false, paidServiceCancelled: false };
            }
          } else if (attStatus === 'cancelled' || attVal === -2) {
            // Встановлюємо null тільки якщо в БД ще не встановлено true
            if ((c as any).paidServiceAttended !== true) {
              c = { ...c, paidServiceAttended: null, paidServiceCancelled: true };
            } else {
              c = { ...c, paidServiceCancelled: false };
            }
          }
          // Якщо статус 'pending' або невідомо - НЕ змінюємо значення з БД
          // Це дозволяє зберегти встановлені раніше значення, навіть якщо в KV storage немає даних
        } catch (err) {
          console.warn('[direct/clients] ⚠️ Не вдалося нормалізувати paidServiceAttended з KV (не критично):', err);
        }

        // Дораховуємо суму поточного платного запису (грн) по paid-групі цього дня.
        try {
          const computed = computeServicesTotalCostUAH(currentGroup.services || []);
          if (computed > 0) {
            const current = typeof (c as any).paidServiceTotalCost === 'number' ? (c as any).paidServiceTotalCost : null;
            if (!current || current !== computed) {
              c = { ...c, paidServiceTotalCost: computed };
            }
          }
        } catch (err) {
          console.warn('[direct/clients] ⚠️ Не вдалося дорахувати paidServiceTotalCost (не критично):', err);
        }

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
        // Додаткова перевірка: якщо вибраний майстер є адміністратором за роллю - не використовуємо його
        const isValidMaster = picked?.staffName && !isAdminByName(picked.staffName);
        const finalPicked = isValidMaster ? picked : null;
        let pickedMasterId: string | undefined = undefined;
        if (finalPicked?.staffId != null) {
          // Перевага: матч по altegioStaffId
          for (const [dmId, staffId] of directMasterIdToStaffId.entries()) {
            if (staffId === picked.staffId) {
              pickedMasterId = dmId;
              break;
            }
          }
        }
        if (!pickedMasterId && finalPicked?.staffName) {
          const full = finalPicked.staffName.trim().toLowerCase();
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
          paidServiceRebookFromMasterName: finalPicked?.staffName || undefined,
          paidServiceRebookFromMasterId: pickedMasterId,
        };
      });
    } catch (err) {
      console.warn('[direct/clients] ⚠️ Не вдалося обчислити "Перезапис" (не критично):', err);
    }

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
    
    // ВАЖЛИВО: Altegio рахує консультацію як “візит”.
    // Правило: консультацію показуємо, якщо visits = 0 або visits = 1.
    // Ігноруємо консультацію тільки коли visits >= 2.
    // - не показуємо в колонці "Запис на консультацію"
    // - не дозволяємо відкривати "Історія консультацій"
    // - не ведемо лічильник спроб консультації
    clients = clients.map((c) => {
      const hadConsult = Boolean((c as any).consultationBookingDate);
      const shouldIgnoreConsult = (c.visits ?? 0) >= 2 && !hadConsult;
      if (shouldIgnoreConsult) {
        return {
          ...c,
          consultationDate: undefined,
          consultationBookingDate: undefined,
          consultationAttended: null,
          consultationCancelled: false,
          consultationMasterId: undefined,
          consultationMasterName: undefined,
          consultationAttemptNumber: undefined,
        };
      }
      return c;
    });

    // Додаємо останні 5 станів до кожного клієнта
    // getLast5StatesForClients вже відфільтрувала дублікати стану "client" та "lead"
    const clientsWithStates = clients.map(client => {
      const clientStates = statesMap.get(client.id) || [];
      return {
      ...client,
        last5States: clientStates,
      };
    });

    // Додаємо інфо для колонки "Переписка":
    // - messagesTotal: кількість повідомлень у DirectMessage (поки що це основні вхідні з ManyChat webhook)
    // - chatNeedsAttention: якщо є нові ВХІДНІ після (chatStatusCheckedAt ?? chatStatusSetAt)
    // - chatStatusName/chatStatusBadgeKey: для tooltip/бейджа
    const clientsWithChatMeta = await (async () => {
      try {
        const ids = clientsWithStates.map((c) => c.id);
        if (!ids.length) return clientsWithStates;

        const [totalCounts, lastIncoming] = await Promise.all([
          prisma.directMessage.groupBy({
            by: ['clientId'],
            where: { clientId: { in: ids } },
            _count: { _all: true },
          }),
          prisma.directMessage.groupBy({
            by: ['clientId'],
            where: { clientId: { in: ids }, direction: 'incoming' },
            _max: { receivedAt: true },
          }),
        ]);

        const totalMap = new Map<string, number>();
        for (const r of totalCounts) {
          totalMap.set(r.clientId, (r as any)?._count?._all ?? 0);
        }

        const lastIncomingMap = new Map<string, Date>();
        for (const r of lastIncoming) {
          const dt = (r as any)?._max?.receivedAt as Date | null | undefined;
          if (dt instanceof Date && !isNaN(dt.getTime())) {
            lastIncomingMap.set(r.clientId, dt);
          }
        }

        const statusIds = Array.from(
          new Set(
            clientsWithStates
              .map((c) => (c as any).chatStatusId)
              .filter((v: any): v is string => typeof v === 'string' && v.trim().length > 0)
          )
        );

        const statuses =
          statusIds.length > 0
            ? await prisma.directChatStatus.findMany({
                where: { id: { in: statusIds } },
                select: { id: true, name: true, badgeKey: true, isActive: true },
              })
            : [];
        const statusMap = new Map<string, { name: string; badgeKey: string; isActive: boolean }>();
        for (const s of statuses) statusMap.set(s.id, { name: s.name, badgeKey: (s as any).badgeKey || 'badge_1', isActive: s.isActive });

        return clientsWithStates.map((c) => {
          const messagesTotal = totalMap.get(c.id) ?? 0;
          const lastIn = lastIncomingMap.get(c.id) ?? null;

          const stId = ((c as any).chatStatusId || '').toString().trim() || '';
          const st = stId ? statusMap.get(stId) : null;
          
          const checkedAtIso = (c as any).chatStatusCheckedAt as string | undefined;
          const setAtIso = (c as any).chatStatusSetAt as string | undefined;
          const thresholdIso = (checkedAtIso || setAtIso || '').toString().trim();
          const thresholdTs = thresholdIso ? new Date(thresholdIso).getTime() : NaN;

          // Правило:
          // - якщо є threshold (checkedAt/setAt) → needsAttention лише коли є нові вхідні ПІСЛЯ threshold
          // - якщо threshold нема і статус НЕ встановлено → needsAttention коли є хоча б одне вхідне (lastIn)
          const chatNeedsAttention = (() => {
            if (!lastIn) return false;
            if (Number.isFinite(thresholdTs)) return lastIn.getTime() > thresholdTs;
            const hasStatus = Boolean(stId);
            return !hasStatus;
          })();

          return {
            ...c,
            messagesTotal,
            chatNeedsAttention,
            chatStatusName: st?.name || undefined,
            chatStatusBadgeKey: st?.badgeKey || undefined,
          };
        });
      } catch (err) {
        console.warn('[direct/clients] ⚠️ Не вдалося додати метадані переписки (не критично):', err);
        return clientsWithStates;
      }
    })();

    // Додаємо похідне поле: daysSinceLastVisit (по днях Europe/Kyiv).
    // UI показує лише число днів.
    const clientsWithDaysSinceLastVisit = (() => {
      try {
        const todayKyivDay = kyivDayFromISO(new Date().toISOString());
        const toDayIndex = (day: string): number => {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day || '').trim());
          if (!m) return NaN;
          const y = Number(m[1]);
          const mo = Number(m[2]);
          const d = Number(m[3]);
          if (!y || !mo || !d) return NaN;
          return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
        };
        const todayIdx = toDayIndex(todayKyivDay);
        if (!Number.isFinite(todayIdx)) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'clients/route.ts:819',message:'todayIdx is not finite',data:{todayKyivDay,todayIdx},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          return clientsWithChatMeta;
        }

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'clients/route.ts:821',message:'Starting daysSinceLastVisit calculation',data:{totalClients:clientsWithChatMeta.length,todayKyivDay,todayIdx},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion

        const result = clientsWithChatMeta.map((c, index) => {
          // Джерело 1: lastVisitAt з Altegio API (пріоритет)
          let iso = ((c as any).lastVisitAt || '').toString().trim();

          // Fallback: якщо lastVisitAt відсутній — використовуємо дати візитів, які точно відбулись
          if (!iso) {
            const candidates: string[] = [];
            if (c.paidServiceAttended === true && c.paidServiceDate) {
              candidates.push((typeof c.paidServiceDate === 'string' ? c.paidServiceDate : (c.paidServiceDate as Date)?.toISOString?.()) || '');
            }
            if (c.consultationAttended === true && c.consultationBookingDate) {
              candidates.push((typeof c.consultationBookingDate === 'string' ? c.consultationBookingDate : (c.consultationBookingDate as Date)?.toISOString?.()) || '');
            }
            if (candidates.length > 0) {
              const sorted = candidates.filter(Boolean).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
              iso = sorted[0] || '';
            }
          }
          
          if (!iso) {
            return { ...c, daysSinceLastVisit: undefined };
          }
          const day = kyivDayFromISO(iso);
          const idx = toDayIndex(day);
          
          // #region agent log
          if (index < 5) {
            fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'clients/route.ts:840',message:'Calculated day and index',data:{clientId:c.id,iso,day,idx,isFinite:Number.isFinite(idx)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          }
          // #endregion
          
          if (!Number.isFinite(idx)) {
            // #region agent log
            if (index < 5) {
              fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'clients/route.ts:845',message:'Index is not finite',data:{clientId:c.id,iso,day,idx},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            }
            // #endregion
            return { ...c, daysSinceLastVisit: undefined };
          }
          const diff = todayIdx - idx;
          const daysSinceLastVisit = diff < 0 ? 0 : diff;
          
          // #region agent log
          if (index < 5) {
            fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'clients/route.ts:852',message:'Calculated daysSinceLastVisit',data:{clientId:c.id,diff,daysSinceLastVisit},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          }
          // #endregion
          
          return { ...c, daysSinceLastVisit };
        });

        // #region agent log
        const withDays = result.filter(c => typeof (c as any).daysSinceLastVisit === 'number');
        const withoutDays = result.filter(c => typeof (c as any).daysSinceLastVisit !== 'number');
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'clients/route.ts:860',message:'Days calculation summary',data:{total:result.length,withDays:withDays.length,withoutDays:withoutDays.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion

        return result;
      } catch (err) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'clients/route.ts:865',message:'Error calculating daysSinceLastVisit',data:{error:err instanceof Error ? err.message : String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        console.warn('[direct/clients] ⚠️ Не вдалося порахувати daysSinceLastVisit (не критично):', err);
        return clientsWithChatMeta;
      }
    })();

    // Фільтри колонок (Act, Днів, Inst, Стан, Консультація, Запис, Майстер) — Europe/Kyiv для дат
    const todayKyiv = kyivDayFromISO(new Date().toISOString());
    const currentMonthKyiv = todayKyiv.slice(0, 7);
    const startOfMonth = `${currentMonthKyiv}-01`;
    const toYyyyMm = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso).slice(0, 7) : '');
    const toKyivDay = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso) : '');
    /** Дата створення запису на консультацію (fallback на consultationBookingDate для узгодженості з UI) */
    // «Консультації створені» = тільки дата створення запису (consultationRecordCreatedAt), не підставляти дату консультації (booking).
    const getConsultCreatedAt = (c: DirectClient): string | null | undefined =>
      (c as any).consultationRecordCreatedAt ?? undefined;
    const parseActYear = (y: string | null): string => {
      if (!y) return '';
      const n = parseInt(y, 10);
      if (n >= 26 && n <= 28) return `20${String(n).padStart(2, '0')}`;
      return '';
    };
    const parseMonth = (m: string | null): string => {
      if (!m) return '';
      const n = parseInt(m, 10);
      if (n >= 1 && n <= 12) return String(n).padStart(2, '0');
      return '';
    };
    const splitPipe = (s: string | null): string[] =>
      (s || '').split('|').map((x) => x.trim()).filter(Boolean);
    const splitComma = (s: string | null): string[] =>
      (s || '').split(',').map((x) => x.trim()).filter(Boolean);
    /** Перший токен (ім'я) для фільтра майстрів — об'єднання "Ім'я" та "Ім'я Прізвище". */
    const firstToken = (name: string | null | undefined): string => {
      const t = (name || '').toString().trim();
      return (t.split(/\s+/)[0] || '').trim();
    };

    let filtered = [...clientsWithDaysSinceLastVisit];

    if (actMode === 'current_month') {
      filtered = filtered.filter((c) => toYyyyMm(c.updatedAt) === currentMonthKyiv);
    } else if (actMode === 'year_month' && actYear && actMonth) {
      const y = parseActYear(actYear);
      const m = parseMonth(actMonth);
      if (y && m) {
        const target = `${y}-${m}`;
        filtered = filtered.filter((c) => toYyyyMm(c.updatedAt) === target);
      }
    }

    if (daysFilter === 'none') {
      filtered = filtered.filter((c) => typeof (c as any).daysSinceLastVisit !== 'number' || !Number.isFinite((c as any).daysSinceLastVisit));
    } else if (daysFilter === 'growing') {
      filtered = filtered.filter((c) => {
        const d = (c as any).daysSinceLastVisit;
        return typeof d === 'number' && Number.isFinite(d) && d >= 0 && d < 60;
      });
    } else if (daysFilter === 'grown') {
      filtered = filtered.filter((c) => {
        const d = (c as any).daysSinceLastVisit;
        return typeof d === 'number' && Number.isFinite(d) && d >= 60 && d < 90;
      });
    } else if (daysFilter === 'overgrown') {
      filtered = filtered.filter((c) => {
        const d = (c as any).daysSinceLastVisit;
        return typeof d === 'number' && Number.isFinite(d) && d >= 90;
      });
    }

    const instIds = splitComma(instFilter);
    if (instIds.length > 0) {
      const set = new Set(instIds);
      filtered = filtered.filter((c) => {
        const id = (c as any).chatStatusId as string | undefined;
        return id && set.has(id);
      });
    }

    const stateIds = splitComma(stateFilter);
    if (stateIds.length > 0) {
      const set = new Set(stateIds);
      filtered = filtered.filter((c) => c.state && set.has(c.state));
    }

    // Фільтри по колонках (Консультація, Запис, Майстер) об'єднуються за OR: показуємо клієнтів, що підходять під будь-який із них
    const hasConsultationFilters =
      consultHasConsultation === 'true' ||
      consultCreatedMode === 'current_month' ||
      (consultCreatedMode === 'year_month' && consultCreatedYear && consultCreatedMonth) ||
      consultCreatedPreset != null ||
      consultAppointedMode === 'current_month' ||
      (consultAppointedMode === 'year_month' && consultAppointedYear && consultAppointedMonth) ||
      consultAppointedPreset != null ||
      consultAttendance != null ||
      consultType != null ||
      (splitPipe(consultMasters).length > 0);
    const hasRecordFilters =
      recordHasRecord === 'true' ||
      recordNewClient === 'true' ||
      recordCreatedMode === 'current_month' ||
      (recordCreatedMode === 'year_month' && recordCreatedYear && recordCreatedMonth) ||
      recordCreatedPreset != null ||
      recordAppointedMode === 'current_month' ||
      (recordAppointedMode === 'year_month' && recordAppointedYear && recordAppointedMonth) ||
      recordAppointedPreset != null ||
      recordClient != null ||
      recordSum != null ||
      (masterHands && [2, 4, 6].includes(parseInt(masterHands, 10)));
    const hasMasterFilters = splitPipe(masterPrimary).length > 0 || splitPipe(masterSecondary).length > 0;
    const hasColumnFilters = hasConsultationFilters || hasRecordFilters || hasMasterFilters;

    if (hasColumnFilters) {
      const base = [...filtered];

      const applyConsultation = (arr: typeof base) => {
        let out = arr;
        // «Консультації створені» = дата створення запису; період як у Статистиці — з початку місяця до сьогодні.
        if (consultCreatedMode === 'current_month') {
          out = out.filter((c) => {
            const day = toKyivDay(getConsultCreatedAt(c));
            return day && day >= startOfMonth && day <= todayKyiv;
          });
        } else if (consultCreatedMode === 'year_month' && consultCreatedYear && consultCreatedMonth) {
          const y = parseActYear(consultCreatedYear);
          const m = parseMonth(consultCreatedMonth);
          if (y && m) out = out.filter((c) => toYyyyMm(getConsultCreatedAt(c)) === `${y}-${m}`);
        }
        if (consultCreatedPreset === 'past') {
          out = out.filter((c) => toKyivDay(getConsultCreatedAt(c)) && toKyivDay(getConsultCreatedAt(c))! < todayKyiv);
        } else if (consultCreatedPreset === 'today') {
          out = out.filter((c) => toKyivDay(getConsultCreatedAt(c)) === todayKyiv);
        } else if (consultCreatedPreset === 'future') {
          out = out.filter((c) => toKyivDay(getConsultCreatedAt(c)) && toKyivDay(getConsultCreatedAt(c))! > todayKyiv);
        }
        if (consultAppointedMode === 'current_month') {
          out = out.filter((c) => toYyyyMm(c.consultationBookingDate) === currentMonthKyiv);
        } else if (consultAppointedMode === 'year_month' && consultAppointedYear && consultAppointedMonth) {
          const y = parseActYear(consultAppointedYear);
          const m = parseMonth(consultAppointedMonth);
          if (y && m) out = out.filter((c) => toYyyyMm(c.consultationBookingDate) === `${y}-${m}`);
        }
        if (consultAppointedPreset === 'past') {
          out = out.filter((c) => toKyivDay(c.consultationBookingDate) && toKyivDay(c.consultationBookingDate) < todayKyiv);
        } else if (consultAppointedPreset === 'today') {
          out = out.filter((c) => toKyivDay(c.consultationBookingDate) === todayKyiv);
        } else if (consultAppointedPreset === 'future') {
          out = out.filter((c) => toKyivDay(c.consultationBookingDate) && toKyivDay(c.consultationBookingDate) > todayKyiv);
        }
        if (consultAttendance === 'attended') out = out.filter((c) => c.consultationAttended === true);
        else if (consultAttendance === 'no_show') out = out.filter((c) => c.consultationAttended === false && !c.consultationCancelled);
        else if (consultAttendance === 'cancelled') out = out.filter((c) => !!c.consultationCancelled);
        if (consultType === 'consultation') out = out.filter((c) => !(c as any).isOnlineConsultation);
        else if (consultType === 'online') out = out.filter((c) => !!(c as any).isOnlineConsultation);
        const consultMasterListLocal = splitPipe(consultMasters);
        if (consultMasterListLocal.length > 0) {
          const norms = new Set(consultMasterListLocal.map((x) => firstToken(x).toLowerCase().trim()).filter(Boolean));
          out = out.filter((c) => {
            const first = firstToken(c.consultationMasterName).toLowerCase().trim();
            return first && norms.has(first);
          });
        }
        return out;
      };

      const applyRecord = (arr: typeof base) => {
        let out = arr;
        if (recordHasRecord === 'true') {
          out = out.filter((c) => c.paidServiceDate != null && String(c.paidServiceDate).trim() !== '');
        }
        if (recordNewClient === 'true') {
          out = out.filter((c) => c.consultationAttended === true && c.paidServiceDate != null && String(c.paidServiceDate).trim() !== '');
        }
        if (recordCreatedMode === 'current_month') {
          out = out.filter((c) => toYyyyMm((c as any).paidServiceRecordCreatedAt) === currentMonthKyiv);
        } else if (recordCreatedMode === 'year_month' && recordCreatedYear && recordCreatedMonth) {
          const y = parseActYear(recordCreatedYear);
          const m = parseMonth(recordCreatedMonth);
          if (y && m) out = out.filter((c) => toYyyyMm((c as any).paidServiceRecordCreatedAt) === `${y}-${m}`);
        }
        if (recordCreatedPreset === 'past') {
          out = out.filter((c) => toKyivDay((c as any).paidServiceRecordCreatedAt) && toKyivDay((c as any).paidServiceRecordCreatedAt) < todayKyiv);
        } else if (recordCreatedPreset === 'today') {
          out = out.filter((c) => toKyivDay((c as any).paidServiceRecordCreatedAt) === todayKyiv);
        } else if (recordCreatedPreset === 'future') {
          out = out.filter((c) => toKyivDay((c as any).paidServiceRecordCreatedAt) && toKyivDay((c as any).paidServiceRecordCreatedAt) > todayKyiv);
        }
        if (recordAppointedMode === 'current_month') {
          out = out.filter((c) => toYyyyMm(c.paidServiceDate) === currentMonthKyiv);
        } else if (recordAppointedMode === 'year_month' && recordAppointedYear && recordAppointedMonth) {
          const y = parseActYear(recordAppointedYear);
          const m = parseMonth(recordAppointedMonth);
          if (y && m) out = out.filter((c) => toYyyyMm(c.paidServiceDate) === `${y}-${m}`);
        }
        if (recordAppointedPreset === 'past') {
          out = out.filter((c) => toKyivDay(c.paidServiceDate) && toKyivDay(c.paidServiceDate) < todayKyiv);
        } else if (recordAppointedPreset === 'today') {
          out = out.filter((c) => toKyivDay(c.paidServiceDate) === todayKyiv);
        } else if (recordAppointedPreset === 'future') {
          out = out.filter((c) => toKyivDay(c.paidServiceDate) && toKyivDay(c.paidServiceDate) > todayKyiv);
        }
        if (recordClient === 'attended') out = out.filter((c) => c.paidServiceAttended === true);
        else if (recordClient === 'no_show') out = out.filter((c) => c.paidServiceAttended === false && !c.paidServiceCancelled);
        else if (recordClient === 'cancelled') out = out.filter((c) => !!c.paidServiceCancelled);
        else if (recordClient === 'pending') {
          out = out.filter((c) => {
            if (!c.paidServiceDate) return false;
            const d = toKyivDay(c.paidServiceDate);
            if (!d || d < todayKyiv) return false;
            return c.paidServiceAttended !== true && c.paidServiceAttended !== false && !c.paidServiceCancelled;
          });
        } else if (recordClient === 'rebook') out = out.filter((c) => !!(c as any).paidServiceIsRebooking);
        else if (recordClient === 'unknown') {
          out = out.filter((c) => {
            if (!c.paidServiceDate) return false;
            const d = toKyivDay(c.paidServiceDate);
            if (!d || d >= todayKyiv) return false;
            return c.paidServiceAttended !== true && c.paidServiceAttended !== false && !c.paidServiceCancelled;
          });
        }
        if (recordSum === 'lt_10k') out = out.filter((c) => typeof c.paidServiceTotalCost === 'number' && c.paidServiceTotalCost < 10000);
        else if (recordSum === 'gt_10k') out = out.filter((c) => typeof c.paidServiceTotalCost === 'number' && c.paidServiceTotalCost >= 10000);
        const handsNum = masterHands ? parseInt(masterHands, 10) : NaN;
        if (Number.isFinite(handsNum) && (handsNum === 2 || handsNum === 4 || handsNum === 6)) {
          out = out.filter((c) => (c as any).paidServiceHands === handsNum);
        }
        return out;
      };

      const applyMaster = (arr: typeof base) => {
        let out = arr;
        const primaryListLocal = splitPipe(masterPrimary);
        if (primaryListLocal.length > 0) {
          const norms = new Set(primaryListLocal.map((x) => firstToken(x).toLowerCase().trim()).filter(Boolean));
          out = out.filter((c) => {
            const firstService = firstToken(c.serviceMasterName).toLowerCase().trim();
            if (firstService && norms.has(firstService)) return true;
            const mid = c.masterId ? directMasterIdToName.get(c.masterId) : null;
            return !!firstToken(mid || '').toLowerCase().trim() && norms.has(firstToken(mid || '').toLowerCase().trim());
          });
        }
        const secondaryListLocal = splitPipe(masterSecondary);
        if (secondaryListLocal.length > 0) {
          const norms = new Set(secondaryListLocal.map((x) => firstToken(x).toLowerCase().trim()).filter(Boolean));
          out = out.filter((c) => {
            const first = firstToken((c as any).serviceSecondaryMasterName).toLowerCase().trim();
            return first && norms.has(first);
          });
        }
        return out;
      };

      const consultationPart = hasConsultationFilters ? applyConsultation(base) : [];
      const recordPart = hasRecordFilters ? applyRecord(base) : [];
      const masterPart = hasMasterFilters ? applyMaster(base) : [];
      const resultIds = new Set<string>();
      for (const c of consultationPart) resultIds.add(c.id);
      for (const c of recordPart) resultIds.add(c.id);
      for (const c of masterPart) resultIds.add(c.id);
      filtered = base.filter((c) => resultIds.has(c.id));
    } else {
      // Жодного фільтра по колонках — застосовуємо AND-логіку нижче
    }

    if (!hasColumnFilters) {
    if (consultHasConsultation === 'true') {
      filtered = filtered.filter((c) => c.consultationBookingDate != null && String(c.consultationBookingDate).trim() !== '');
    }
    // «Консультації створені» = дата створення запису; період як у Статистиці — з початку місяця до сьогодні.
    if (consultCreatedMode === 'current_month') {
      filtered = filtered.filter((c) => {
        const day = toKyivDay(getConsultCreatedAt(c));
        return day && day >= startOfMonth && day <= todayKyiv;
      });
    } else if (consultCreatedMode === 'year_month' && consultCreatedYear && consultCreatedMonth) {
      const y = parseActYear(consultCreatedYear);
      const m = parseMonth(consultCreatedMonth);
      if (y && m) {
        const target = `${y}-${m}`;
        filtered = filtered.filter((c) => toYyyyMm(getConsultCreatedAt(c)) === target);
      }
    }

    if (consultAppointedMode === 'current_month') {
      filtered = filtered.filter((c) => toYyyyMm(c.consultationBookingDate) === currentMonthKyiv);
    } else if (consultAppointedMode === 'year_month' && consultAppointedYear && consultAppointedMonth) {
      const y = parseActYear(consultAppointedYear);
      const m = parseMonth(consultAppointedMonth);
      if (y && m) {
        const target = `${y}-${m}`;
        filtered = filtered.filter((c) => toYyyyMm(c.consultationBookingDate) === target);
      }
    }

    if (consultAppointedPreset === 'past') {
      filtered = filtered.filter((c) => {
        const d = toKyivDay(c.consultationBookingDate);
        return !!d && d < todayKyiv;
      });
    } else if (consultAppointedPreset === 'today') {
      filtered = filtered.filter((c) => toKyivDay(c.consultationBookingDate) === todayKyiv);
    } else if (consultAppointedPreset === 'future') {
      filtered = filtered.filter((c) => {
        const d = toKyivDay(c.consultationBookingDate);
        return !!d && d > todayKyiv;
      });
    }

    if (consultAttendance === 'attended') {
      filtered = filtered.filter((c) => c.consultationAttended === true);
    } else if (consultAttendance === 'no_show') {
      filtered = filtered.filter((c) => c.consultationAttended === false && !c.consultationCancelled);
    } else if (consultAttendance === 'cancelled') {
      filtered = filtered.filter((c) => !!c.consultationCancelled);
    }

    if (consultType === 'consultation') {
      filtered = filtered.filter((c) => !(c as any).isOnlineConsultation);
    } else if (consultType === 'online') {
      filtered = filtered.filter((c) => !!(c as any).isOnlineConsultation);
    }

    const consultMasterList = splitPipe(consultMasters);
    if (consultMasterList.length > 0) {
      const norms = new Set(consultMasterList.map((x) => firstToken(x).toLowerCase().trim()).filter(Boolean));
      filtered = filtered.filter((c) => {
        const first = firstToken(c.consultationMasterName).toLowerCase().trim();
        return first && norms.has(first);
      });
    }

    if (recordHasRecord === 'true') {
      filtered = filtered.filter((c) => c.paidServiceDate != null && String(c.paidServiceDate).trim() !== '');
    }
    if (recordNewClient === 'true') {
      filtered = filtered.filter((c) => c.consultationAttended === true && c.paidServiceDate != null && String(c.paidServiceDate).trim() !== '');
    }
    if (recordCreatedMode === 'current_month') {
      filtered = filtered.filter((c) => toYyyyMm((c as any).paidServiceRecordCreatedAt) === currentMonthKyiv);
    } else if (recordCreatedMode === 'year_month' && recordCreatedYear && recordCreatedMonth) {
      const y = parseActYear(recordCreatedYear);
      const m = parseMonth(recordCreatedMonth);
      if (y && m) {
        const target = `${y}-${m}`;
        filtered = filtered.filter((c) => toYyyyMm((c as any).paidServiceRecordCreatedAt) === target);
      }
    }

    if (recordAppointedMode === 'current_month') {
      filtered = filtered.filter((c) => toYyyyMm(c.paidServiceDate) === currentMonthKyiv);
    } else if (recordAppointedMode === 'year_month' && recordAppointedYear && recordAppointedMonth) {
      const y = parseActYear(recordAppointedYear);
      const m = parseMonth(recordAppointedMonth);
      if (y && m) {
        const target = `${y}-${m}`;
        filtered = filtered.filter((c) => toYyyyMm(c.paidServiceDate) === target);
      }
    }

    if (recordAppointedPreset === 'past') {
      filtered = filtered.filter((c) => {
        const d = toKyivDay(c.paidServiceDate);
        return !!d && d < todayKyiv;
      });
    } else if (recordAppointedPreset === 'today') {
      filtered = filtered.filter((c) => toKyivDay(c.paidServiceDate) === todayKyiv);
    } else if (recordAppointedPreset === 'future') {
      filtered = filtered.filter((c) => {
        const d = toKyivDay(c.paidServiceDate);
        return !!d && d > todayKyiv;
      });
    }

    if (recordClient === 'attended') {
      filtered = filtered.filter((c) => c.paidServiceAttended === true);
    } else if (recordClient === 'no_show') {
      filtered = filtered.filter((c) => c.paidServiceAttended === false && !c.paidServiceCancelled);
    } else if (recordClient === 'cancelled') {
      filtered = filtered.filter((c) => !!c.paidServiceCancelled);
    } else if (recordClient === 'pending') {
      filtered = filtered.filter((c) => {
        if (!c.paidServiceDate) return false;
        const d = toKyivDay(c.paidServiceDate);
        if (!d || d < todayKyiv) return false;
        return c.paidServiceAttended !== true && c.paidServiceAttended !== false && !c.paidServiceCancelled;
      });
    } else if (recordClient === 'rebook') {
      filtered = filtered.filter((c) => !!(c as any).paidServiceIsRebooking);
    } else if (recordClient === 'unknown') {
      filtered = filtered.filter((c) => {
        if (!c.paidServiceDate) return false;
        const d = toKyivDay(c.paidServiceDate);
        if (!d || d >= todayKyiv) return false;
        return c.paidServiceAttended !== true && c.paidServiceAttended !== false && !c.paidServiceCancelled;
      });
    }

    if (recordSum === 'lt_10k') {
      filtered = filtered.filter((c) => typeof c.paidServiceTotalCost === 'number' && c.paidServiceTotalCost < 10000);
    } else if (recordSum === 'gt_10k') {
      filtered = filtered.filter((c) => typeof c.paidServiceTotalCost === 'number' && c.paidServiceTotalCost >= 10000);
    }

    const handsNum = masterHands ? parseInt(masterHands, 10) : NaN;
    if (Number.isFinite(handsNum) && (handsNum === 2 || handsNum === 4 || handsNum === 6)) {
      filtered = filtered.filter((c) => (c as any).paidServiceHands === handsNum);
    }

    const primaryList = splitPipe(masterPrimary);
    if (primaryList.length > 0) {
      const norms = new Set(primaryList.map((x) => firstToken(x).toLowerCase().trim()).filter(Boolean));
      filtered = filtered.filter((c) => {
        const firstService = firstToken(c.serviceMasterName).toLowerCase().trim();
        if (firstService && norms.has(firstService)) return true;
        const mid = c.masterId ? directMasterIdToName.get(c.masterId) : null;
        const firstResp = firstToken(mid || '').toLowerCase().trim();
        return !!firstResp && norms.has(firstResp);
      });
    }

    const secondaryList = splitPipe(masterSecondary);
    if (secondaryList.length > 0) {
      const norms = new Set(secondaryList.map((x) => firstToken(x).toLowerCase().trim()).filter(Boolean));
      filtered = filtered.filter((c) => {
        const first = firstToken((c as any).serviceSecondaryMasterName).toLowerCase().trim();
        return first && norms.has(first);
      });
    }
    }

    // Сортування після обчислення daysSinceLastVisit і messagesTotal
    filtered.sort((a, b) => {
      let aVal: any = (a as any)[sortBy];
      let bVal: any = (b as any)[sortBy];

      if (sortBy === 'statusId') {
        aVal = statusMap.get(a.statusId) || '';
        bVal = statusMap.get(b.statusId) || '';
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
      } else if (sortBy === 'masterId') {
        aVal = a.serviceMasterName || '';
        bVal = b.serviceMasterName || '';
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
      } else if (sortBy === 'daysSinceLastVisit') {
        aVal = typeof (a as any).daysSinceLastVisit === 'number' && Number.isFinite((a as any).daysSinceLastVisit) ? (a as any).daysSinceLastVisit : -1;
        bVal = typeof (b as any).daysSinceLastVisit === 'number' && Number.isFinite((b as any).daysSinceLastVisit) ? (b as any).daysSinceLastVisit : -1;
      } else if (sortBy === 'messagesTotal') {
        aVal = typeof (a as any).messagesTotal === 'number' && Number.isFinite((a as any).messagesTotal) ? (a as any).messagesTotal : 0;
        bVal = typeof (b as any).messagesTotal === 'number' && Number.isFinite((b as any).messagesTotal) ? (b as any).messagesTotal : 0;
      } else if (sortBy.includes('Date') || sortBy === 'firstContactDate' || sortBy === 'consultationDate' || sortBy === 'visitDate' || sortBy === 'paidServiceDate' || sortBy === 'consultationBookingDate' || sortBy === 'updatedAt' || sortBy === 'createdAt') {
        aVal = aVal ? new Date(aVal).getTime() : 0;
        bVal = bVal ? new Date(bVal).getTime() : 0;
      } else if (sortBy === 'visitedSalon' || sortBy === 'signedUpForPaidService' || sortBy === 'consultationAttended' || sortBy === 'signedUpForPaidServiceAfterConsultation') {
        aVal = aVal ? 1 : 0;
        bVal = bVal ? 1 : 0;
      } else if (typeof aVal === 'string' || typeof bVal === 'string') {
        aVal = (aVal ?? '').toString().toLowerCase();
        bVal = (bVal ?? '').toString().toLowerCase();
      } else {
        aVal = aVal ?? '';
        bVal = bVal ?? '';
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      }
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    });

    console.log(`[direct/clients] GET: Returning ${filtered.length} clients after filtering and sorting`);

    // Джерело даних для розділу Статистика — таблиця (той самий список з тими ж фільтрами).
    if (statsOnly) {
      const periodStats = computePeriodStats(filtered);
      return NextResponse.json({
        ok: true,
        totalCount: filtered.length,
        periodStats,
      });
    }
    
    const response = { 
      ok: true, 
      clients: filtered,
      totalCount, // Загальна кількість всіх клієнтів в базі
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

    await saveDirectClient(client, 'direct-clients-post', { source: 'ui' }, { touchUpdatedAt: false });

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
