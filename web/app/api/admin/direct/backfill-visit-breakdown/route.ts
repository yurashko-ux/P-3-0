// web/app/api/admin/direct/backfill-visit-breakdown/route.ts
// Backfill paidServiceVisitId та paidServiceVisitBreakdown з API (GET /records, GET /visits + visit/details).
// Для клієнтів з paidServiceDate беремо visitId з GET /records за client_id + дата, викликаємо API, зберігаємо в БД.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import { getClientRecords, isConsultationService } from '@/lib/altegio/records';
import { fetchVisitBreakdownFromAPI, getVisitWithRecords, getVisitDetails } from '@/lib/altegio/visits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const ALTEGIO_COMPANY_ID = process.env.ALTEGIO_COMPANY_ID || '';

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

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const companyId = parseInt(ALTEGIO_COMPANY_ID, 10);
  if (!companyId || Number.isNaN(companyId)) {
    return NextResponse.json({
      ok: false,
      error: 'ALTEGIO_COMPANY_ID не налаштовано',
    }, { status: 400 });
  }

  try {
    const altegioClientIdParam = req.nextUrl.searchParams.get('altegioClientId')?.trim();
    const clientIdParam = req.nextUrl.searchParams.get('clientId')?.trim();
    const singleClientMode = !!(altegioClientIdParam || clientIdParam);

    const baseWhere: { altegioClientId: { not: null } | number; paidServiceDate: { not: null }; id?: string } = {
      altegioClientId: { not: null },
      paidServiceDate: { not: null },
    };
    if (altegioClientIdParam) {
      const parsed = parseInt(altegioClientIdParam, 10);
      if (Number.isNaN(parsed)) {
        return NextResponse.json({
          ok: false,
          error: `Невірний altegioClientId: "${altegioClientIdParam}". Очікується число.`,
        }, { status: 400 });
      }
      baseWhere.altegioClientId = parsed;
    }
    if (clientIdParam) {
      baseWhere.id = clientIdParam;
    }

    let clients = await prisma.directClient.findMany({
      where: baseWhere,
      select: {
        id: true,
        instagramUsername: true,
        altegioClientId: true,
        paidServiceDate: true,
        paidServiceVisitId: true,
      },
    });

    if (singleClientMode && clients.length === 0) {
      return NextResponse.json({
        ok: true,
        singleClient: true,
        reason: 'client_not_found',
        message: altegioClientIdParam
          ? `Клієнт з altegioClientId="${altegioClientIdParam}" не знайдений або не має paidServiceDate`
          : `Клієнт з id="${clientIdParam}" не знайдений або не має paidServiceDate`,
      });
    }

    let updated = 0;
    let errors = 0;
    let noRecords = 0;
    let noMatchingRecord = 0;
    let noBreakdown = 0;
    const details: Array<{ instagram: string; reason: string; visitId?: number }> = [];
    
    // Детальна діагностика для першого клієнта
    let debugInfo: any = null;

    let singleClientResult: Record<string, unknown> | null = null;

    for (const client of clients) {
      const altegioClientId = client.altegioClientId!;
      const paidServiceDate = client.paidServiceDate!;
      const paidKyivDay = kyivDayFromISO(paidServiceDate.toISOString?.() ?? String(paidServiceDate));

      if (singleClientMode) {
        singleClientResult = {
          singleClient: true,
          client: {
            id: client.id,
            instagramUsername: client.instagramUsername,
            altegioClientId,
            paidServiceDate: paidServiceDate?.toISOString?.() ?? String(paidServiceDate),
            paidKyivDay,
          },
        };
      }

      if (!paidKyivDay) {
        details.push({ instagram: client.instagramUsername, reason: 'no kyivDay from paidServiceDate' });
        if (singleClientMode) {
          return NextResponse.json({
            ok: true,
            ...singleClientResult,
            reason: 'no_kyivDay',
            step1_records: null,
            step2_visitId: null,
            step3_breakdown: null,
          });
        }
        continue;
      }

      let visitId: number | null = null;
      let records: Awaited<ReturnType<typeof getClientRecords>> = [];
      try {
        records = await getClientRecords(companyId, altegioClientId);
        if (singleClientMode) {
          (singleClientResult as any).step1_records = {
            count: records.length,
            sample: records.slice(0, 5).map((r) => ({
              date: r.date,
              visit_id: r.visit_id,
              servicesCount: r.services?.length ?? 0,
            })),
          };
        }
        if (!records.length) {
          noRecords++;
          if (details.length < 10) details.push({ instagram: client.instagramUsername, reason: 'API returned no records' });
          if (singleClientMode) {
            return NextResponse.json({
              ok: true,
              ...singleClientResult,
              reason: 'noRecords',
              step2_visitId: null,
              step3_breakdown: null,
            });
          }
          continue;
        }

        const dayRecords = records.filter((r) => {
          if (!r.date) return false;
          return kyivDayFromISO(r.date) === paidKyivDay;
        });
        const paidRecord = dayRecords.find((r) => !isConsultationService(r.services ?? []).isConsultation) ?? dayRecords[0];
        if (!paidRecord || paidRecord.visit_id == null) {
          noMatchingRecord++;
          if (details.length < 10) details.push({ instagram: client.instagramUsername, reason: 'no record matching paidServiceDate', visitId: undefined });
          if (singleClientMode) {
            return NextResponse.json({
              ok: true,
              ...singleClientResult,
              reason: 'noMatchingRecord',
              step2_visitId: null,
              step3_breakdown: null,
              dayRecordsCount: dayRecords.length,
              allRecordsDates: records.map((r) => r.date).filter(Boolean),
            });
          }
          continue;
        }
        visitId = paidRecord.visit_id;
        if (singleClientMode) {
          (singleClientResult as any).step2_visitId = visitId;
        }
      } catch (err) {
        noRecords++;
        if (details.length < 10) details.push({ instagram: client.instagramUsername, reason: `getClientRecords error: ${err instanceof Error ? err.message : err}` });
        if (singleClientMode) {
          return NextResponse.json({
            ok: false,
            ...singleClientResult,
            reason: 'error',
            error: err instanceof Error ? err.message : String(err),
            step1_records: (singleClientResult as any)?.step1_records ?? null,
            step2_visitId: null,
            step3_breakdown: null,
          });
        }
        continue;
      }

      try {
        // Для першого клієнта — детальна діагностика структури API
        if (!debugInfo) {
          try {
            const visitData = await getVisitWithRecords(visitId, companyId);
            let detailsData: any = null;
            let allItems: any[] = [];
            if (visitData && visitData.records?.length > 0) {
              const firstRecordId = visitData.records[0]?.id;
              if (firstRecordId) {
                detailsData = await getVisitDetails(visitData.locationId ?? companyId, firstRecordId, visitId);
                allItems = Array.isArray(detailsData?.items) ? detailsData.items : [];
              }
            }
            // Показуємо всі items з їх ключами та значеннями для master/staff
            const itemsDebug = allItems.slice(0, 5).map((item: any, i: number) => ({
              index: i,
              keys: Object.keys(item),
              master_id: item.master_id,
              staff_id: item.staff_id,
              specialist_id: item.specialist_id,
              master: item.master,
              staff: item.staff,
              specialist: item.specialist,
              title: item.title,
              cost: item.cost,
              amount: item.amount,
            }));
            debugInfo = {
              visitId,
              companyId,
              locationId: visitData?.locationId,
              recordsCount: visitData?.records?.length,
              itemsCount: allItems.length,
              itemsDebug,
              firstRecordStaff: visitData?.records?.[0]?.staff,
            };
          } catch (e) {
            debugInfo = { error: e instanceof Error ? e.message : String(e), visitId };
          }
        }

        const breakdown = await fetchVisitBreakdownFromAPI(visitId, companyId);
        if (singleClientMode) {
          (singleClientResult as any).step3_breakdown = breakdown;
        }
        if (!breakdown || breakdown.length === 0) {
          noBreakdown++;
          if (details.length < 10) details.push({ instagram: client.instagramUsername, reason: 'API returned empty breakdown', visitId });
          if (singleClientMode) {
            return NextResponse.json({
              ok: true,
              ...singleClientResult,
              reason: 'noBreakdown',
            });
          }
          continue;
        }

        await prisma.directClient.update({
          where: { id: client.id },
          data: {
            paidServiceVisitId: visitId,
            paidServiceVisitBreakdown: breakdown as any,
          },
        });
        updated++;
        if (details.length < 10) details.push({ instagram: client.instagramUsername, reason: 'updated', visitId });
        if (singleClientMode) {
          const totalCost = breakdown?.reduce((a, b) => a + b.sumUAH, 0);
          return NextResponse.json({
            ok: true,
            ...singleClientResult,
            reason: 'updated',
            totalCost,
          });
        }
      } catch (err) {
        errors++;
        if (details.length < 10) details.push({ instagram: client.instagramUsername, reason: `error: ${err instanceof Error ? err.message : String(err)}`, visitId });
        console.warn('[backfill-visit-breakdown] client', client.id, client.instagramUsername, err);
        if (singleClientMode) {
          return NextResponse.json({
            ok: false,
            ...singleClientResult,
            reason: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      total: clients.length,
      updated,
      errors,
      noRecords,
      noMatchingRecord,
      noBreakdown,
      details,
      debugInfo,
    });
  } catch (err) {
    console.error('[backfill-visit-breakdown]', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
