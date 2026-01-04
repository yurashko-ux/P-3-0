// web/app/api/admin/direct/merge-duplicates-by-name/route.ts
// Об'єднання дублікатів клієнтів по імені та прізвищу

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAllDirectClients } from '@/lib/direct-store';
import { getStateHistory } from '@/lib/direct-state-log';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${ADMIN_PASS}` || authHeader === `Bearer ${CRON_SECRET}`) {
    return true;
  }

  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/**
 * POST - об'єднати дублікати клієнтів по імені та прізвищу
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const allClients = await getAllDirectClients();
    
    // Групуємо клієнтів по імені + прізвище
    const clientsByName = new Map<string, typeof allClients>();
    
    for (const client of allClients) {
      const firstName = (client.firstName || '').trim().toLowerCase();
      const lastName = (client.lastName || '').trim().toLowerCase();
      
      if (firstName && lastName) {
        const nameKey = `${firstName} ${lastName}`;
        if (!clientsByName.has(nameKey)) {
          clientsByName.set(nameKey, []);
        }
        clientsByName.get(nameKey)!.push(client);
      }
    }
    
    const results: Array<{
      name: string;
      duplicates: Array<{
        id: string;
        instagramUsername: string;
        altegioClientId?: number;
        hasRecords: boolean;
        kept: boolean;
      }>;
    }> = [];
    
    let totalMerged = 0;
    
    // Обробляємо кожну групу з кількома клієнтами
    for (const [name, clients] of clientsByName.entries()) {
      if (clients.length <= 1) {
        continue; // Немає дублікатів
      }
      
      // Перевіряємо записи для кожного клієнта
      const clientsWithRecords = await Promise.all(
        clients.map(async (client) => {
          const history = await getStateHistory(client.id);
          const hasRecords = 
            history.length > 1 ||
            !!client.paidServiceDate ||
            !!client.consultationBookingDate ||
            !!client.consultationDate ||
            !!client.visitDate ||
            !!client.lastMessageAt;
          
          return {
            client,
            hasRecords,
          };
        })
      );
      
      // Знаходимо клієнта, якого залишити
      // Пріоритет:
      // 1. Клієнт з правильним Instagram (не missing_instagram_*)
      // 2. Клієнт з записями (state logs, дати)
      // 3. Клієнт з altegioClientId
      // 4. Найновіший клієнт
      
      let clientToKeep = clientsWithRecords[0].client;
      let keepHasRecords = clientsWithRecords[0].hasRecords;
      
      for (const { client, hasRecords } of clientsWithRecords) {
        const keepHasRealInstagram = !clientToKeep.instagramUsername.startsWith('missing_instagram_');
        const currentHasRealInstagram = !client.instagramUsername.startsWith('missing_instagram_');
        
        // Якщо поточний клієнт має правильний Instagram, а збережений - ні
        if (!keepHasRealInstagram && currentHasRealInstagram) {
          clientToKeep = client;
          keepHasRecords = hasRecords;
          continue;
        }
        
        // Якщо обидва мають або не мають правильний Instagram
        if (keepHasRealInstagram === currentHasRealInstagram) {
          // Пріоритет: той, хто має записи
          if (!keepHasRecords && hasRecords) {
            clientToKeep = client;
            keepHasRecords = hasRecords;
            continue;
          }
          
          // Якщо обидва мають або не мають записи
          if (keepHasRecords === hasRecords) {
            // Пріоритет: той, хто має altegioClientId
            if (!clientToKeep.altegioClientId && client.altegioClientId) {
              clientToKeep = client;
              keepHasRecords = hasRecords;
              continue;
            }
            
            // Якщо обидва мають або не мають altegioClientId - залишаємо новіший
            if (new Date(client.createdAt) > new Date(clientToKeep.createdAt)) {
              clientToKeep = client;
              keepHasRecords = hasRecords;
              continue;
            }
          }
        }
      }
      
      // Об'єднуємо інших клієнтів у клієнта, якого залишаємо
      const duplicates = clientsWithRecords.filter(({ client }) => client.id !== clientToKeep.id);
      
      if (duplicates.length > 0) {
        const duplicateIds = duplicates.map(({ client }) => client.id);
        
        // Переносимо дані з дублікатів до клієнта, якого залишаємо
        const { saveDirectClient } = await import('@/lib/direct-store');
        
        // Оновлюємо клієнта, якого залишаємо, з даними з дублікатів
        let updatedClient = { ...clientToKeep };
        
        for (const { client: duplicate } of duplicates) {
          // Переносимо altegioClientId, якщо його немає
          if (!updatedClient.altegioClientId && duplicate.altegioClientId) {
            updatedClient.altegioClientId = duplicate.altegioClientId;
          }
          
          // Переносимо Instagram, якщо він правильний
          if (updatedClient.instagramUsername.startsWith('missing_instagram_') && 
              !duplicate.instagramUsername.startsWith('missing_instagram_')) {
            updatedClient.instagramUsername = duplicate.instagramUsername;
          }
          
          // Переносимо дати, якщо їх немає
          if (!updatedClient.visitDate && duplicate.visitDate) {
            updatedClient.visitDate = duplicate.visitDate;
            updatedClient.visitedSalon = duplicate.visitedSalon;
          }
          
          if (!updatedClient.paidServiceDate && duplicate.paidServiceDate) {
            updatedClient.paidServiceDate = duplicate.paidServiceDate;
            updatedClient.signedUpForPaidService = duplicate.signedUpForPaidService;
          }
          
          if (!updatedClient.consultationDate && duplicate.consultationDate) {
            updatedClient.consultationDate = duplicate.consultationDate;
          }
          
          if (!updatedClient.consultationBookingDate && duplicate.consultationBookingDate) {
            updatedClient.consultationBookingDate = duplicate.consultationBookingDate;
          }
          
          if (!updatedClient.lastMessageAt && duplicate.lastMessageAt) {
            updatedClient.lastMessageAt = duplicate.lastMessageAt;
          }
          
          // Переносимо коментар, якщо його немає
          if (!updatedClient.comment && duplicate.comment) {
            updatedClient.comment = duplicate.comment;
          }
        }
        
        updatedClient.updatedAt = new Date().toISOString();
        await saveDirectClient(updatedClient);
        
        // Видаляємо дублікати
        const { deleteDirectClient } = await import('@/lib/direct-store');
        for (const duplicateId of duplicateIds) {
          await deleteDirectClient(duplicateId);
        }
        
        totalMerged += duplicates.length;
        
        results.push({
          name,
          duplicates: [
            {
              id: clientToKeep.id,
              instagramUsername: clientToKeep.instagramUsername,
              altegioClientId: clientToKeep.altegioClientId,
              hasRecords: keepHasRecords,
              kept: true,
            },
            ...duplicates.map(({ client, hasRecords }) => ({
              id: client.id,
              instagramUsername: client.instagramUsername,
              altegioClientId: client.altegioClientId,
              hasRecords,
              kept: false,
            })),
          ],
        });
        
        console.log(`[merge-duplicates-by-name] ✅ Merged ${duplicates.length} duplicates for "${name}", kept client ${clientToKeep.id}`);
      }
    }
    
    return NextResponse.json({
      ok: true,
      totalMerged,
      totalGroups: results.length,
      results,
    });
  } catch (error) {
    console.error('[merge-duplicates-by-name] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

