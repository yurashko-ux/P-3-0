// web/app/api/admin/direct/debug-records/route.ts
// Діагностичний endpoint для перевірки структури записів в KV

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { getAllDirectClients } from '@/lib/direct-store';

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
 * GET - діагностика записів в KV
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get('clientId'); // Altegio Client ID

    // Отримуємо записи з KV
    const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 99); // Перші 100 для діагностики
    
    const allClients = await getAllDirectClients();
    const clientsWithHairExtension = allClients.filter(
      (c) => c.state === 'hair-extension' && c.altegioClientId
    );

    // Парсимо записи
    const parsedRecords = recordsLogRaw
      .map((raw, index) => {
        try {
          let parsed: any;
          if (typeof raw === 'string') {
            parsed = JSON.parse(raw);
          } else {
            parsed = raw;
          }
          
          if (
            parsed &&
            typeof parsed === 'object' &&
            'value' in parsed &&
            typeof parsed.value === 'string'
          ) {
            try {
              parsed = JSON.parse(parsed.value);
            } catch {
              return { index, error: 'Failed to parse value', raw };
            }
          }
          
          return { index, parsed, raw: typeof raw };
        } catch (err) {
          return { index, error: err instanceof Error ? err.message : String(err), raw: typeof raw };
        }
      })
      .filter(r => !r.error);

    // Якщо вказано clientId - фільтруємо
    let filteredRecords = parsedRecords;
    if (clientId) {
      const targetClientId = parseInt(clientId, 10);
      filteredRecords = parsedRecords.filter((r: any) => {
        if (!r.parsed) return false;
        const recordClientId = r.parsed.clientId || 
                               (r.parsed.data && r.parsed.data.client && r.parsed.data.client.id);
        return parseInt(String(recordClientId), 10) === targetClientId;
      });
    }

    // Аналізуємо структуру
    const analysis = {
      totalRecordsInKV: recordsLogRaw.length,
      successfullyParsed: parsedRecords.length,
      filteredRecords: filteredRecords.length,
      sampleRecord: filteredRecords.length > 0 ? filteredRecords[0] : parsedRecords[0],
      clientsWithHairExtension: clientsWithHairExtension.length,
      sampleClient: clientsWithHairExtension.length > 0 ? {
        id: clientsWithHairExtension[0].id,
        instagramUsername: clientsWithHairExtension[0].instagramUsername,
        altegioClientId: clientsWithHairExtension[0].altegioClientId,
        state: clientsWithHairExtension[0].state,
      } : null,
    };

    // Перевіряємо структуру services в записах
    const recordsWithServices = filteredRecords
      .filter((r: any) => {
        if (!r.parsed) return false;
        const services = r.parsed.data?.services || r.parsed.services || [];
        return Array.isArray(services) && services.length > 0;
      })
      .map((r: any) => {
        const services = r.parsed.data?.services || r.parsed.services || [];
        return {
          clientId: r.parsed.clientId || (r.parsed.data && r.parsed.data.client && r.parsed.data.client.id),
          services: services.map((s: any) => ({
            id: s.id,
            title: s.title || s.name,
            cost: s.cost,
          })),
          hasConsultation: services.some((s: any) => 
            (s.title || s.name) && /консультація/i.test(s.title || s.name)
          ),
          hasHairExtension: services.some((s: any) => 
            (s.title || s.name) && /нарощування/i.test(s.title || s.name)
          ),
          receivedAt: r.parsed.receivedAt,
          datetime: r.parsed.datetime || r.parsed.data?.datetime,
        };
      });

    return NextResponse.json({
      ok: true,
      analysis,
      recordsWithServices: recordsWithServices.slice(0, 10), // Перші 10
      totalRecordsWithServices: recordsWithServices.length,
    });
  } catch (error) {
    console.error('[direct/debug-records] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
