// web/app/api/admin/direct/test-status-save/route.ts
// Тестовий endpoint для перевірки збереження статусів

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, directKeys } from '@/lib/kv';
import { saveDirectStatus, getAllDirectStatuses } from '@/lib/direct-store';
import type { DirectStatus } from '@/lib/direct-types';

export const dynamic = 'force-dynamic';

// Копіюємо unwrapKVResponse
function unwrapKVResponse(data: any, maxAttempts = 20): any {
  let current: any = data;
  let attempts = 0;
  const seenStrings = new Set<string>();
  
  while (attempts < maxAttempts) {
    attempts++;
    
    if (Array.isArray(current)) {
      const filtered = current.filter(item => item !== null && item !== undefined);
      return filtered.length > 0 ? filtered : current;
    }
    
    if (typeof current === 'string') {
      if (!current.trim()) {
        return current;
      }
      
      const trimmed = current.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        if (seenStrings.has(current)) {
          try {
            const parsed = JSON.parse(current);
            if (Array.isArray(parsed)) {
              return parsed.filter(item => item !== null && item !== undefined);
            }
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const extracted = parsed.value ?? parsed.result ?? parsed.data;
              if (extracted !== undefined && extracted !== null) {
                current = extracted;
                seenStrings.delete(current);
                continue;
              }
            }
            return parsed;
          } catch {
            return current;
          }
        }
        
        seenStrings.add(current);
        try {
          const parsed = JSON.parse(current);
          current = parsed;
          continue;
        } catch {
          return current;
        }
      } else {
        return current;
      }
    }
    
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      const extracted = (current as any).value ?? (current as any).result ?? (current as any).data;
      if (extracted !== undefined && extracted !== null) {
        current = extracted;
        if (typeof extracted === 'string') {
          seenStrings.delete(extracted);
        }
        continue;
      }
    }
    
    if (current === null || current === undefined || typeof current !== 'object') {
      return current;
    }
    
    break;
  }
  
  if (typeof current === 'string') {
    const trimmed = current.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(current);
        if (Array.isArray(parsed)) {
          return parsed.filter(item => item !== null && item !== undefined);
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const extracted = parsed.value ?? parsed.result ?? parsed.data;
          if (extracted !== undefined && extracted !== null) {
            return unwrapKVResponse(extracted, 5);
          }
        }
        return parsed;
      } catch {
        // ignore
      }
    }
  }
  
  return current;
}

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

    console.log('[test-status-save] Starting test...');

    // 1. Перевіряємо поточний стан індексу
    const beforeIndex = await kvRead.getRaw(directKeys.STATUS_INDEX);
    let beforeParsed: any = null;
    let beforeLength = 0;
    if (beforeIndex) {
      beforeParsed = unwrapKVResponse(beforeIndex);
      beforeLength = Array.isArray(beforeParsed) ? beforeParsed.length : 0;
    }

    // 2. Створюємо тестовий статус
    const testStatus: DirectStatus = {
      id: `test_status_${Date.now()}`,
      name: `Test Status ${Date.now()}`,
      color: '#ff0000',
      order: 999,
      isDefault: false,
      createdAt: new Date().toISOString(),
    };

    console.log('[test-status-save] Creating test status:', testStatus.id);

    // 3. Зберігаємо статус
    try {
      await saveDirectStatus(testStatus);
      console.log('[test-status-save] ✅ Status saved successfully');
    } catch (saveErr) {
      console.error('[test-status-save] ❌ Failed to save status:', saveErr);
      return NextResponse.json({
        ok: false,
        error: 'Failed to save status',
        details: saveErr instanceof Error ? saveErr.message : String(saveErr),
      });
    }

    // 4. Затримка для eventual consistency
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 5. Перевіряємо індекс після збереження
    const afterIndex = await kvRead.getRaw(directKeys.STATUS_INDEX);
    let afterParsed: any = null;
    let afterLength = 0;
    let foundInIndex = false;
    if (afterIndex) {
      afterParsed = unwrapKVResponse(afterIndex);
      afterLength = Array.isArray(afterParsed) ? afterParsed.length : 0;
      foundInIndex = Array.isArray(afterParsed) && afterParsed.includes(testStatus.id);
    }

    // 6. Перевіряємо, чи статус зберігся в KV
    const statusData = await kvRead.getRaw(directKeys.STATUS_ITEM(testStatus.id));
    let statusFound = false;
    let statusParsed: any = null;
    if (statusData) {
      statusParsed = unwrapKVResponse(statusData);
      statusFound = statusParsed && statusParsed.id === testStatus.id;
    }

    // 7. Перевіряємо через getAllDirectStatuses
    const allStatuses = await getAllDirectStatuses();
    const foundInGetAll = allStatuses.some(s => s.id === testStatus.id);

    // 8. Видаляємо тестовий статус
    try {
      await kvWrite.setRaw(directKeys.STATUS_ITEM(testStatus.id), '');
      if (afterParsed && Array.isArray(afterParsed)) {
        const cleaned = afterParsed.filter((id: string) => id !== testStatus.id);
        await kvWrite.setRaw(directKeys.STATUS_INDEX, JSON.stringify(cleaned));
      }
    } catch (cleanupErr) {
      console.warn('[test-status-save] Failed to cleanup test status:', cleanupErr);
    }

    return NextResponse.json({
      ok: true,
      test: {
        statusId: testStatus.id,
        beforeIndex: {
          exists: !!beforeIndex,
          length: beforeLength,
          raw: beforeIndex ? (typeof beforeIndex === 'string' ? beforeIndex.slice(0, 200) : String(beforeIndex).slice(0, 200)) : null,
          parsed: beforeParsed,
        },
        afterIndex: {
          exists: !!afterIndex,
          length: afterLength,
          foundInIndex,
          raw: afterIndex ? (typeof afterIndex === 'string' ? afterIndex.slice(0, 200) : String(afterIndex).slice(0, 200)) : null,
          parsed: afterParsed,
        },
        statusInKV: {
          exists: !!statusData,
          found: statusFound,
          raw: statusData ? (typeof statusData === 'string' ? statusData.slice(0, 200) : String(statusData).slice(0, 200)) : null,
          parsed: statusParsed,
        },
        getAllDirectStatuses: {
          total: allStatuses.length,
          found: foundInGetAll,
        },
        summary: {
          saved: statusFound,
          inIndex: foundInIndex,
          inGetAll: foundInGetAll,
          indexIncreased: afterLength > beforeLength,
        },
      },
    });
  } catch (error) {
    console.error('[test-status-save] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

