// web/app/api/admin/direct/fix-online-consultations/route.ts
// Оновлює isOnlineConsultation для існуючих клієнтів на основі webhook'ів

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  const ADMIN_PASS = process.env.ADMIN_PASS || '';
  const CRON_SECRET = process.env.CRON_SECRET || '';
  
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
 * Перевіряє, чи є послуга "Консультація" або "Онлайн-консультація"
 * Повертає об'єкт з інформацією про те, чи це консультація та чи це онлайн-консультація
 */
function isConsultationService(services: any[]): { isConsultation: boolean; isOnline: boolean } {
  if (!Array.isArray(services) || services.length === 0) {
    return { isConsultation: false, isOnline: false };
  }
  
  let isConsultation = false;
  let isOnline = false;
  
  services.forEach((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    if (/консультація/i.test(title)) {
      isConsultation = true;
      // Перевіряємо, чи це онлайн-консультація
      if (/онлайн/i.test(title) || /online/i.test(title)) {
        isOnline = true;
      }
    }
  });
  
  return { isConsultation, isOnline };
}

// Функція для обробки оновлення
async function fixOnlineConsultations() {
  // Отримуємо всіх клієнтів з consultationBookingDate
  const allClients = await getAllDirectClients();
  
  try {
    const clientsWithConsultation = allClients.filter(
      (c) => c.consultationBookingDate && (!c.isOnlineConsultation || c.isOnlineConsultation === undefined)
    );

    console.log(`[fix-online-consultations] Всього клієнтів: ${allClients.length}`);
    console.log(`[fix-online-consultations] Клієнтів з consultationBookingDate: ${allClients.filter(c => c.consultationBookingDate).length}`);
    console.log(`[fix-online-consultations] Знайдено ${clientsWithConsultation.length} клієнтів з консультаціями для перевірки (isOnlineConsultation = false або undefined)`);

    let updatedCount = 0;
    let checkedCount = 0;

    // Для кожного клієнта перевіряємо webhook'и
    for (const client of clientsToCheck) {
      checkedCount++;

      try {
        // Отримуємо всі webhook'и для цього клієнта
        const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
        const clientRecords = recordsLogRaw
          .map((raw) => {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
                try {
                  return JSON.parse(parsed.value);
                } catch {
                  return null;
                }
              }
              return parsed;
            } catch {
              return null;
            }
          })
          .filter(
            (r) =>
              r &&
              r.clientId === client.altegioClientId &&
              r.data &&
              Array.isArray(r.data.services)
          )
          .sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());

        // Перевіряємо, чи є серед послуг "Онлайн-консультація"
        let foundOnlineConsultation = false;
        for (const record of clientRecords) {
          const services = record.data?.services || [];
          const consultationInfo = isConsultationService(services);
          
          if (consultationInfo.isConsultation && consultationInfo.isOnline) {
            foundOnlineConsultation = true;
            break;
          }
        }

        // Якщо знайшли онлайн-консультацію, оновлюємо клієнта
        if (foundOnlineConsultation) {
          const updated = {
            ...client,
            isOnlineConsultation: true,
            updatedAt: new Date().toISOString(),
          };

          await saveDirectClient(updated, 'fix-online-consultations', {
            altegioClientId: client.altegioClientId,
            instagramUsername: client.instagramUsername,
            reason: 'Оновлення isOnlineConsultation на основі webhook історії',
          });

          updatedCount++;
          console.log(
            `[fix-online-consultations] ✅ Оновлено клієнта ${client.instagramUsername} (${client.firstName} ${client.lastName || ''}) - встановлено isOnlineConsultation = true`
          );
        }
      } catch (err) {
        console.error(
          `[fix-online-consultations] ❌ Помилка при обробці клієнта ${client.instagramUsername}:`,
          err
        );
      }
    }

    return {
      success: true,
      checked: checkedCount,
      updated: updatedCount,
      totalClients: allClients.length,
      clientsWithAltegioId: allClients.filter(c => c.altegioClientId).length,
      clientsWithConsultationBookingDate: allClients.filter(c => c.consultationBookingDate).length,
      clientsWithConsultationDate: allClients.filter(c => c.consultationDate).length,
      message: `Перевірено ${checkedCount} клієнтів, оновлено ${updatedCount} записів`,
    };
  } catch (err: any) {
    console.error('[fix-online-consultations] ❌ Помилка:', err);
    throw err;
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await fixOnlineConsultations();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[fix-online-consultations] ❌ Помилка:', err);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: err?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await fixOnlineConsultations();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[fix-online-consultations] ❌ Помилка:', err);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: err?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
