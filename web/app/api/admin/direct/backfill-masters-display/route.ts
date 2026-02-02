// web/app/api/admin/direct/backfill-masters-display/route.ts
// Backfill consultationMasterName та serviceMasterName через Visit Details API (формат "Головний (Інший1, Інший2)")

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { prisma } from '@/lib/prisma';
import { getMastersDisplayFromVisitDetails } from '@/lib/altegio/visits';

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

function isConsultationService(services: any[]): boolean {
  if (!Array.isArray(services) || services.length === 0) return false;
  return services.some((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    return /консультаці/i.test(title);
  });
}

function hasPaidService(services: any[]): boolean {
  if (!Array.isArray(services) || services.length === 0) return false;
  return services.some((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    return /нарощування/i.test(title) || (/консультаці/i.test(title) === false && title.length > 0);
  });
}

function parseRecord(raw: unknown): Record<string, unknown> | null {
  try {
    let parsed: any;
    if (typeof raw === 'string') {
      parsed = JSON.parse(raw);
    } else {
      parsed = raw;
    }
    if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
      try {
        parsed = JSON.parse(parsed.value);
      } catch {
        return null;
      }
    }
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

type RecordInfo = {
  datetime: string;
  recordId: number;
  visitId: number;
  companyId: number;
  staffName: string | null;
  services: any[];
};

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
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
    const allRaw = [...rawItemsRecords, ...rawItemsWebhook];

    const records = allRaw.map(parseRecord).filter((r): r is Record<string, unknown> => {
      if (!r) return false;
      const clientId = r.clientId ?? (r.data as any)?.clientId ?? (r.data as any)?.client?.id ?? (r.body as any)?.data?.client?.id;
      const datetime = r.datetime ?? (r.data as any)?.datetime ?? (r.body as any)?.data?.datetime;
      const recordId = r.recordId ?? (r.body as any)?.resource_id;
      const visitId = r.visitId ?? (r.body as any)?.data?.visit_id ?? (r.body as any)?.resource_id;
      return clientId != null && datetime != null && recordId != null && visitId != null;
    }) as Array<{
      clientId?: number;
      data?: { clientId?: number; client?: { id: number }; datetime?: string; services?: any[]; staff?: { name?: string; display_name?: string }; company_id?: number };
      body?: { resource_id?: number; data?: { visit_id?: number; datetime?: string; services?: any[]; staff?: { name?: string; display_name?: string }; company_id?: number } };
      recordId?: number;
      visitId?: number;
      datetime?: string;
      companyId?: number;
    }>;

    const clientRecordsMap = new Map<number, RecordInfo[]>();

    for (const r of records) {
      const clientId = r.clientId ?? r.data?.clientId ?? r.data?.client?.id ?? r.body?.data?.client?.id;
      const numClientId = typeof clientId === 'number' ? clientId : parseInt(String(clientId), 10);
      if (Number.isNaN(numClientId)) continue;

      const datetime = r.datetime ?? r.data?.datetime ?? r.body?.data?.datetime;
      const recordId = Number(r.recordId ?? r.body?.resource_id);
      const visitId = Number(r.visitId ?? r.body?.data?.visit_id ?? r.body?.resource_id);
      const compId = Number(r.companyId ?? r.data?.company_id ?? r.body?.data?.company_id ?? companyId);
      const staff = r.data?.staff ?? r.body?.data?.staff;
      const staffName = staff?.name ?? staff?.display_name ?? null;
      const services = r.data?.services ?? r.body?.data?.services ?? [];
      if (!Array.isArray(services) || services.length === 0) continue;

      const info: RecordInfo = { datetime: String(datetime), recordId, visitId, companyId: compId, staffName, services };
      if (!clientRecordsMap.has(numClientId)) clientRecordsMap.set(numClientId, []);
      clientRecordsMap.get(numClientId)!.push(info);
    }

    const clients = await prisma.directClient.findMany({
      where: { altegioClientId: { not: null } },
      select: {
        id: true,
        instagramUsername: true,
        altegioClientId: true,
        consultationMasterName: true,
        serviceMasterName: true,
      },
    });

    let consultationUpdated = 0;
    let serviceUpdated = 0;
    let consultationSkipped = 0;
    let serviceSkipped = 0;
    let errors = 0;
    const details: Array<{ instagramUsername: string | null; altegioClientId: number | null; consultation?: string; service?: string }> = [];

    for (const client of clients) {
      const altegioClientId = client.altegioClientId!;
      const list = clientRecordsMap.get(altegioClientId) || [];
      if (list.length === 0) continue;

      const sorted = [...list].sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

      const consultationRecords = sorted.filter((rec) => isConsultationService(rec.services));
      const paidOrAnyRecords = sorted.filter((rec) => hasPaidService(rec.services) || isConsultationService(rec.services));
      const latestConsultation = consultationRecords[0];
      const latestForService = paidOrAnyRecords[0];

      try {
        if (latestConsultation && latestConsultation.recordId && latestConsultation.visitId) {
          const display = await getMastersDisplayFromVisitDetails(
            latestConsultation.companyId || companyId,
            latestConsultation.recordId,
            latestConsultation.visitId,
            latestConsultation.staffName
          );
          const newConsult = display ?? latestConsultation.staffName ?? null;
          const prevConsult = (client.consultationMasterName || '').trim() || null;
          if (newConsult && newConsult !== prevConsult) {
            await prisma.directClient.update({
              where: { id: client.id },
              data: { consultationMasterName: newConsult },
            });
            consultationUpdated++;
            details.push({
              instagramUsername: client.instagramUsername,
              altegioClientId: client.altegioClientId,
              consultation: `${prevConsult ?? 'null'} → ${newConsult}`,
            });
          } else {
            consultationSkipped++;
          }
        }
      } catch (e) {
        errors++;
        console.error('[backfill-masters-display] consultation update failed', client.id, e);
      }

      try {
        if (latestForService && latestForService.recordId && latestForService.visitId) {
          const display = await getMastersDisplayFromVisitDetails(
            latestForService.companyId || companyId,
            latestForService.recordId,
            latestForService.visitId,
            latestForService.staffName
          );
          const newService = display ?? latestForService.staffName ?? null;
          const prevService = (client.serviceMasterName || '').trim() || null;
          if (newService && newService !== prevService) {
            await prisma.directClient.update({
              where: { id: client.id },
              data: { serviceMasterName: newService },
            });
            serviceUpdated++;
            const existing = details.find((d) => d.altegioClientId === client.altegioClientId);
            if (existing) existing.service = `${prevService ?? 'null'} → ${newService}`;
            else details.push({ instagramUsername: client.instagramUsername, altegioClientId: client.altegioClientId, service: `${prevService ?? 'null'} → ${newService}` });
          } else {
            serviceSkipped++;
          }
        }
      } catch (e) {
        errors++;
        console.error('[backfill-masters-display] service update failed', client.id, e);
      }
    }

    console.log('[backfill-masters-display] Done', { consultationUpdated, serviceUpdated, consultationSkipped, serviceSkipped, errors });

    return NextResponse.json({
      ok: true,
      results: {
        totalClients: clients.length,
        recordsInLog: records.length,
        consultationUpdated,
        serviceUpdated,
        consultationSkipped,
        serviceSkipped,
        errors,
        details: details.slice(0, 50),
      },
    });
  } catch (error) {
    console.error('[backfill-masters-display] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
