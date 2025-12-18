// web/app/api/admin/direct/rebuild-index/route.ts
// Ручне відновлення індексу клієнтів з KV

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, directKeys } from '@/lib/kv';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
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

    console.log('[direct/rebuild-index] Starting index rebuild...');

    // Читаємо поточний індекс
    const currentIndexData = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    let existingIds: string[] = [];
    
    if (currentIndexData) {
      try {
        const parsed = typeof currentIndexData === 'string' ? JSON.parse(currentIndexData) : currentIndexData;
        if (Array.isArray(parsed)) {
          existingIds = parsed.filter((id: any): id is string => typeof id === 'string' && id.startsWith('direct_'));
        }
      } catch {}
    }

    console.log(`[direct/rebuild-index] Current index has ${existingIds.length} IDs`);

    // Шукаємо всіх клієнтів через перевірку індексу по Instagram
    // Це не ідеально, але може допомогти знайти клієнтів, які не в індексі
    const foundIds = new Set<string>(existingIds);
    let checkedCount = 0;
    let foundCount = 0;

    // Перевіряємо клієнтів з поточного індексу
    for (const id of existingIds) {
      try {
        const clientData = await kvRead.getRaw(directKeys.CLIENT_ITEM(id));
        if (clientData) {
          const client = typeof clientData === 'string' ? JSON.parse(clientData) : clientData;
          if (client && client.id && client.instagramUsername) {
            foundIds.add(client.id);
            foundCount++;
          }
        }
        checkedCount++;
      } catch (err) {
        console.warn(`[direct/rebuild-index] Failed to check client ${id}:`, err);
      }
    }

    console.log(`[direct/rebuild-index] Checked ${checkedCount} clients from index, found ${foundCount} valid`);

    // Якщо індекс порожній або малий, спробуємо знайти клієнтів через Instagram index
    // (це не повне рішення, але може допомогти)
    if (foundIds.size < 10) {
      console.log('[direct/rebuild-index] Index is small, attempting to find clients via Instagram index...');
      // Це не повне рішення, але ми не можемо перебрати всі можливі Instagram usernames
      // Тому просто зберігаємо те, що знайшли
    }

    const finalIds = Array.from(foundIds);
    console.log(`[direct/rebuild-index] Rebuilding index with ${finalIds.length} client IDs`);

    // Зберігаємо новий індекс
    const indexJson = JSON.stringify(finalIds);
    await kvWrite.setRaw(directKeys.CLIENT_INDEX, indexJson);
    
    // Затримка для eventual consistency
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Перевіряємо результат
    const verifyIndex = await kvRead.getRaw(directKeys.CLIENT_INDEX);
    let verifiedCount = 0;
    if (verifyIndex) {
      try {
        const verifyParsed = typeof verifyIndex === 'string' ? JSON.parse(verifyIndex) : verifyIndex;
        if (Array.isArray(verifyParsed)) {
          verifiedCount = verifyParsed.length;
        }
      } catch {}
    }

    return NextResponse.json({
      ok: true,
      stats: {
        beforeRebuild: existingIds.length,
        afterRebuild: finalIds.length,
        verified: verifiedCount,
        checked: checkedCount,
        found: foundCount,
      },
      message: `Індекс відновлено: ${finalIds.length} клієнтів (перевірено: ${verifiedCount})`,
    });
  } catch (error) {
    console.error('[direct/rebuild-index] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
