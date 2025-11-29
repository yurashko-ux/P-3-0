// web/app/api/altegio/reminders/fix-index/route.ts
// Endpoint для виправлення індексу, якщо він не масив

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const indexKey = 'altegio:reminder:index';
    const indexRaw = await kvRead.getRaw(indexKey);
    
    if (!indexRaw) {
      return NextResponse.json({
        ok: true,
        message: 'Index is empty, nothing to fix',
        index: [],
      });
    }

    try {
      const parsed = JSON.parse(indexRaw);
      
      if (Array.isArray(parsed)) {
        return NextResponse.json({
          ok: true,
          message: 'Index is already an array',
          index: parsed,
          count: parsed.length,
        });
      } else {
        // Скидаємо до порожнього масиву
        const fixedIndex: string[] = [];
        await kvWrite.setRaw(indexKey, JSON.stringify(fixedIndex));
        
        return NextResponse.json({
          ok: true,
          message: 'Index was not an array, reset to empty array',
          oldType: typeof parsed,
          oldValue: parsed,
          newIndex: fixedIndex,
        });
      }
    } catch (err) {
      // Помилка парсингу - скидаємо
      const fixedIndex: string[] = [];
      await kvWrite.setRaw(indexKey, JSON.stringify(fixedIndex));
      
      return NextResponse.json({
        ok: true,
        message: 'Failed to parse index, reset to empty array',
        error: err instanceof Error ? err.message : String(err),
        newIndex: fixedIndex,
      });
    }
  } catch (error) {
    console.error('[fix-index] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

