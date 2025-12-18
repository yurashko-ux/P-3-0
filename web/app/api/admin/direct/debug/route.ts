// web/app/api/admin/direct/debug/route.ts
// Діагностичний endpoint для перевірки стану Direct розділу

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, directKeys } from '@/lib/kv';
import { getAllDirectClients } from '@/lib/direct-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // Перевірка авторизації
    const adminToken = req.cookies.get('admin_token')?.value;
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization');
    const isAuthorized = 
      adminToken === process.env.ADMIN_PASS ||
      (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
      !process.env.ADMIN_PASS;

    if (!isAuthorized) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Перевіряємо індекс
    const indexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    let indexParsed: any = null;
    let indexIsArray = false;
    let indexLength = 0;

    if (indexData) {
      try {
        if (typeof indexData === 'string') {
          indexParsed = JSON.parse(indexData);
        } else {
          indexParsed = indexData;
        }
        indexIsArray = Array.isArray(indexParsed);
        indexLength = indexIsArray ? indexParsed.length : 0;
      } catch (err) {
        // Помилка парсингу
      }
    }

    // Перевіряємо кілька клієнтів з індексу
    const sampleClients: any[] = [];
    if (indexIsArray && Array.isArray(indexParsed)) {
      const sampleIds = indexParsed.slice(0, 5);
      for (const id of sampleIds) {
        try {
          const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(id));
          if (clientData) {
            const client = typeof clientData === 'string' ? JSON.parse(clientData) : clientData;
            sampleClients.push({
              id: client?.id,
              instagramUsername: client?.instagramUsername,
              hasId: !!client?.id,
              hasUsername: !!client?.instagramUsername,
            });
          } else {
            sampleClients.push({ id, error: 'Not found in KV' });
          }
        } catch (err) {
          sampleClients.push({ id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    // Отримуємо всіх клієнтів через getAllDirectClients
    const allClients = await getAllDirectClients();

    // Перевіряємо Instagram index для кількох прикладів
    const sampleUsernames = ['mykolayyurashko', 'test', 'example'];
    const instagramIndexChecks: any[] = [];
    for (const username of sampleUsernames) {
      try {
        const idData = await kvRead.getRaw(directKeys.CLIENT_BY_INSTAGRAM(username));
        instagramIndexChecks.push({
          username,
          found: !!idData,
          idData: idData ? (typeof idData === 'string' ? idData.slice(0, 50) : String(idData).slice(0, 50)) : null,
        });
      } catch (err) {
        instagramIndexChecks.push({ username, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({
      ok: true,
      index: {
        exists: !!indexData,
        type: typeof indexData,
        isArray: indexIsArray,
        length: indexLength,
        preview: indexIsArray && Array.isArray(indexParsed) ? indexParsed.slice(0, 10) : indexParsed,
      },
      sampleClients,
      allClientsCount: allClients.length,
      allClientsPreview: allClients.slice(0, 5).map((c) => ({
        id: c.id,
        instagramUsername: c.instagramUsername,
      })),
      instagramIndexChecks,
    });
  } catch (error) {
    console.error('[direct/debug] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
