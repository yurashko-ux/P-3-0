// web/app/api/admin/direct/state-history/route.ts
// API endpoint для отримання історії змін станів клієнта

import { NextRequest, NextResponse } from 'next/server';
import { getClientStateInfo } from '@/lib/direct-state-log';
import { getDirectMasterById, getDirectManager } from '@/lib/direct-masters/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const clientId = searchParams.get('clientId');

    if (!clientId) {
      return NextResponse.json(
        { ok: false, error: 'clientId is required' },
        { status: 400 }
      );
    }

    const info = await getClientStateInfo(clientId);
    
    // Отримуємо дірект-менеджера для стану "Лід"
    const directManager = await getDirectManager();
    
    // Отримуємо історію з masterId для кожного запису
    // Фільтруємо записи зі станом "no-instagram" (видалений стан)
    const filteredHistory = info.history.filter(log => log.state !== 'no-instagram');
    
    const historyWithMasters = await Promise.all(
      filteredHistory.map(async (log) => {
        let masterId: string | undefined = undefined;
        let masterName: string | undefined = undefined;

        // Для стану "Лід" завжди використовуємо дірект-менеджера
        if (log.state === 'lead') {
          if (directManager) {
            masterId = directManager.id;
            masterName = directManager.name;
          }
        } else {
          // Для інших станів спробуємо отримати masterId з метаданих
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
        }

        return {
          ...log,
          masterId,
          masterName,
        };
      })
    );

    // Отримуємо відповідального та дату для поточного стану
    let currentStateMasterId: string | undefined = undefined;
    let currentStateMasterName: string | undefined = undefined;
    let currentStateDate: string | undefined = undefined;
    
    // Отримуємо інформацію про клієнта
    const { prisma } = await import('@/lib/prisma');
    const client = await prisma.directClient.findUnique({
      where: { id: clientId },
      select: { masterId: true, updatedAt: true },
    });
    
    if (info.currentState === 'lead') {
      // Для стану "Лід" завжди використовуємо дірект-менеджера
      if (directManager) {
        currentStateMasterId = directManager.id;
        currentStateMasterName = directManager.name;
      }
    } else {
      // Для інших станів отримуємо з клієнта
      if (client?.masterId) {
        currentStateMasterId = client.masterId;
        const master = await getDirectMasterById(client.masterId);
        if (master) {
          currentStateMasterName = master.name;
        }
      }
    }
    
    // Знаходимо дату останнього логу з поточним станом, або використовуємо дату оновлення клієнта
    const currentStateLog = historyWithMasters.find(log => log.state === info.currentState);
    if (currentStateLog) {
      currentStateDate = currentStateLog.createdAt;
    } else if (client?.updatedAt) {
      currentStateDate = client.updatedAt.toISOString();
    }

    // Якщо поточний стан - "no-instagram", не повертаємо його
    const currentStateValue = info.currentState === 'no-instagram' ? null : info.currentState;
    
    return NextResponse.json({
      ok: true,
      data: {
        ...info,
        currentState: currentStateValue,
        history: historyWithMasters,
        currentStateMasterId,
        currentStateMasterName,
        currentStateDate,
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
