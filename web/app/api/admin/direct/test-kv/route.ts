// web/app/api/admin/direct/test-kv/route.ts
// Тестовий endpoint для перевірки стану KV

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, directKeys } from '@/lib/kv';

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

    const results: any = {};

    // 1. Перевіряємо індекс
    const indexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    results.index = {
      exists: !!indexData,
      type: typeof indexData,
      rawLength: indexData ? (typeof indexData === 'string' ? indexData.length : String(indexData).length) : 0,
      rawPreview: indexData ? (typeof indexData === 'string' ? indexData.slice(0, 200) : String(indexData).slice(0, 200)) : null,
    };

    if (indexData) {
      try {
        const parsed = typeof indexData === 'string' ? JSON.parse(indexData) : indexData;
        results.index.parsed = {
          isArray: Array.isArray(parsed),
          length: Array.isArray(parsed) ? parsed.length : 0,
          type: typeof parsed,
          preview: Array.isArray(parsed) ? parsed.slice(0, 10) : parsed,
        };
      } catch (err) {
        results.index.parseError = err instanceof Error ? err.message : String(err);
      }
    }

    // 2. Перевіряємо кілька конкретних клієнтів
    if (results.index.parsed?.isArray && Array.isArray(results.index.parsed.preview)) {
      results.sampleClients = [];
      for (const id of results.index.parsed.preview.slice(0, 5)) {
        try {
          const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(id));
          if (clientData) {
            const client = typeof clientData === 'string' ? JSON.parse(clientData) : clientData;
            results.sampleClients.push({
              id,
              found: true,
              hasId: !!client?.id,
              hasUsername: !!client?.instagramUsername,
              username: client?.instagramUsername,
            });
          } else {
            results.sampleClients.push({ id, found: false });
          }
        } catch (err) {
          results.sampleClients.push({ id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    // 3. Тест запису
    const testKey = 'direct:test:write';
    const testValue = JSON.stringify({ test: true, timestamp: Date.now() });
    try {
      await kvWrite.setRaw(testKey, testValue);
      await new Promise(resolve => setTimeout(resolve, 500));
      const readBack = await kvRead.getRaw(testKey);
      results.writeTest = {
        success: true,
        written: testValue,
        readBack: readBack ? (typeof readBack === 'string' ? readBack : String(readBack)) : null,
        matches: readBack === testValue || (typeof readBack === 'string' && readBack === testValue),
      };
      // Видаляємо тестовий ключ
      try {
        await kvWrite.setRaw(testKey, JSON.stringify(null));
      } catch {}
    } catch (err) {
      results.writeTest = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error('[direct/test-kv] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
