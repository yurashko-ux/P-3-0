// web/app/api/admin/direct/state-history/route.ts
// API endpoint для отримання історії змін станів клієнта

import { NextRequest, NextResponse } from 'next/server';
import { getClientStateInfo } from '@/lib/direct-state-log';
import { getDirectMasterById } from '@/lib/direct-masters/store';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get('clientId');

    if (!clientId) {
      return NextResponse.json(
        { ok: false, error: 'clientId is required' },
        { status: 400 }
      );
    }

    const info = await getClientStateInfo(clientId);
    
    // Отримуємо історію з masterId для кожного запису
    const historyWithMasters = await Promise.all(
      info.history.map(async (log) => {
        let masterId: string | undefined = undefined;
        let masterName: string | undefined = undefined;

        // Спробуємо отримати masterId з метаданих (якщо він там є)
        if (log.metadata) {
          try {
            const metadata = JSON.parse(log.metadata);
            if (metadata.masterId) {
              masterId = metadata.masterId;
            }
          } catch {
            // Ігноруємо помилки парсингу
          }
        }

        // Отримуємо ім'я майстра
        if (masterId) {
          const master = await getDirectMasterById(masterId);
          if (master) {
            masterName = master.name;
          }
        }

        return {
          ...log,
          masterId,
          masterName,
        };
      })
    );

    return NextResponse.json({
      ok: true,
      data: {
        ...info,
        history: historyWithMasters,
      },
    });
  } catch (err) {
    console.error('[admin/direct/state-history] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
