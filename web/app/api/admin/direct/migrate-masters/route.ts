// web/app/api/admin/direct/migrate-masters/route.ts
// Міграція майстрів з mock-data в базу даних

import { NextRequest, NextResponse } from 'next/server';
import { getMasters } from '@/lib/photo-reports/service';
import { saveDirectMaster, getAllDirectMasters } from '@/lib/direct-masters/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const mockMasters = getMasters();
    const existingMasters = await getAllDirectMasters();
    const existingIds = new Set(existingMasters.map(m => m.id));

    const stats = {
      found: mockMasters.length,
      migrated: 0,
      skipped: 0,
      errors: 0,
    };

    const errors: string[] = [];

    for (const mockMaster of mockMasters) {
      try {
        // Пропускаємо, якщо вже існує
        if (existingIds.has(mockMaster.id)) {
          stats.skipped++;
          continue;
        }

        // Конвертуємо mock master в DirectMaster
        const directMaster = {
          id: mockMaster.id,
          name: mockMaster.name,
          telegramUsername: mockMaster.telegramUsername || undefined,
          role: (mockMaster.role as 'master' | 'direct-manager' | 'admin') || 'master',
          altegioStaffId: mockMaster.altegioStaffId || undefined,
          isActive: true,
          order: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await saveDirectMaster(directMaster);
        stats.migrated++;
        console.log(`[migrate-masters] ✅ Migrated master ${directMaster.id}: ${directMaster.name}`);
      } catch (err) {
        stats.errors++;
        const errorMsg = `Master ${mockMaster.id}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(errorMsg);
        console.error(`[migrate-masters] ❌ ${errorMsg}`);
      }
    }

    const finalCount = (await getAllDirectMasters()).length;

    return NextResponse.json({
      ok: true,
      message: 'Міграція майстрів завершена',
      stats: {
        ...stats,
        finalCount,
      },
      errors: errors.slice(0, 10), // Перші 10 помилок
    });
  } catch (err) {
    console.error('[migrate-masters] Fatal error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
