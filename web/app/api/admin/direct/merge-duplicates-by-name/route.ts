// web/app/api/admin/direct/merge-duplicates-by-name/route.ts
// Об'єднання дублікатів клієнтів по імені та прізвищу

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { getStateHistory } from '@/lib/direct-state-log';
import { createNameComparisonKey, namesMatch } from '@/lib/name-normalize';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  // Перевірка через ADMIN_PASS (кука)
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  // Перевірка через CRON_SECRET
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  // Якщо нічого не налаштовано, дозволяємо (для розробки)
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
    let allClients = await getAllDirectClients();
    console.log(`[merge-duplicates-by-name] 📊 Total clients: ${allClients.length}`);
    
    // КРОК 1: Спочатку об'єднуємо клієнтів за altegioClientId
    // Це важливо, бо клієнти з Manychat можуть мати різні імена (англ vs укр), але один altegioClientId
    const clientsByAltegioId = new Map<number, typeof allClients>();
    
    let clientsWithAltegioId = 0;
    for (const client of allClients) {
      if (client.altegioClientId) {
        clientsWithAltegioId++;
        if (!clientsByAltegioId.has(client.altegioClientId)) {
          clientsByAltegioId.set(client.altegioClientId, []);
        }
        clientsByAltegioId.get(client.altegioClientId)!.push(client);
      }
    }
    console.log(`[merge-duplicates-by-name] 🔍 Clients with altegioClientId in DB: ${clientsWithAltegioId}, Groups: ${clientsByAltegioId.size}`);
    
    // Додатково: знаходимо клієнтів з altegioClientId в username (missing_instagram_*) і додаємо їх до груп
    const clientsWithAltegioIdInUsername = allClients.filter(c => {
      if (!c.instagramUsername.includes('missing_instagram_')) return false;
      const match = c.instagramUsername.match(/missing_instagram_(\d+)/);
      if (!match) return false;
      const altegioIdFromUsername = parseInt(match[1], 10);
      // Додаємо тільки якщо цей клієнт ще не в групі (не має altegioClientId в DB)
      return !c.altegioClientId || c.altegioClientId !== altegioIdFromUsername;
    });
    
    for (const client of clientsWithAltegioIdInUsername) {
      const match = client.instagramUsername.match(/missing_instagram_(\d+)/);
      if (!match) continue;
      const altegioIdFromUsername = parseInt(match[1], 10);
      
      // Якщо клієнт не має altegioClientId в DB, додаємо його до групи
      if (!client.altegioClientId) {
        if (!clientsByAltegioId.has(altegioIdFromUsername)) {
          clientsByAltegioId.set(altegioIdFromUsername, []);
        }
        clientsByAltegioId.get(altegioIdFromUsername)!.push(client);
        console.log(`[merge-duplicates-by-name] 🔍 Added client ${client.id} (${client.firstName} ${client.lastName}) to group by altegioClientId ${altegioIdFromUsername} from username`);
      }
    }
    
    console.log(`[merge-duplicates-by-name] 🔍 After adding clients from username: Groups: ${clientsByAltegioId.size}`);
    
    // Діагностика: показуємо приклади
    if (clientsWithAltegioIdInUsername.length > 0) {
      console.log(`[merge-duplicates-by-name] 🔍 Found ${clientsWithAltegioIdInUsername.length} clients with altegioClientId in username (missing_instagram_*)`);
      // Показуємо перші 5 як приклад
      for (const client of clientsWithAltegioIdInUsername.slice(0, 5)) {
        const match = client.instagramUsername.match(/missing_instagram_(\d+)/);
        const altegioIdFromUsername = match ? parseInt(match[1], 10) : null;
        console.log(`[merge-duplicates-by-name]   - ${client.firstName} ${client.lastName} (${client.instagramUsername}): altegioClientId in DB = ${client.altegioClientId || 'none'}, in username = ${altegioIdFromUsername}`);
      }
    }
    
    const { saveDirectClient, deleteDirectClient } = await import('@/lib/direct-store');
    let totalMergedByAltegioId = 0;
    
    // Обробляємо кожну групу з кількома клієнтами з одним altegioClientId
    for (const [altegioId, clients] of clientsByAltegioId.entries()) {
      if (clients.length <= 1) {
        continue; // Немає дублікатів
      }
      
      console.log(`[merge-duplicates-by-name] 🔍 Found ${clients.length} clients with altegioClientId ${altegioId}`);
      
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
      // Пріоритет: клієнт з реальним Instagram (не missing_instagram_*), потім з записями
      let clientToKeep = clientsWithRecords[0].client;
      let keepHasRecords = clientsWithRecords[0].hasRecords;
      
      for (const { client, hasRecords } of clientsWithRecords) {
        const keepHasRealInstagram = !clientToKeep.instagramUsername.startsWith('missing_instagram_');
        const currentHasRealInstagram = !client.instagramUsername.startsWith('missing_instagram_');
        
        // Пріоритет: клієнт з реальним Instagram
        if (!keepHasRealInstagram && currentHasRealInstagram) {
          clientToKeep = client;
          keepHasRecords = hasRecords;
          continue;
        }
        
        // Якщо обидва мають або не мають реальний Instagram
        if (keepHasRealInstagram === currentHasRealInstagram) {
          // Пріоритет: той, хто має записи
          if (!keepHasRecords && hasRecords) {
            clientToKeep = client;
            keepHasRecords = hasRecords;
            continue;
          }
          
          // Якщо обидва мають або не мають записи - залишаємо новіший
          if (keepHasRecords === hasRecords) {
            if (new Date(client.createdAt) > new Date(clientToKeep.createdAt)) {
              clientToKeep = client;
              keepHasRecords = hasRecords;
            }
          }
        }
      }
      
      // Об'єднуємо інших клієнтів у клієнта, якого залишаємо
      const duplicates = clientsWithRecords.filter(({ client }) => client.id !== clientToKeep.id);
      
      if (duplicates.length > 0) {
        // Переносимо дані з дублікатів до клієнта, якого залишаємо
        let updatedClient = { ...clientToKeep };
        
        for (const { client: duplicate } of duplicates) {
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
        await saveDirectClient(updatedClient, 'merge-duplicates-by-altegio-id');
        
        // Видаляємо дублікати
        for (const { client: duplicate } of duplicates) {
          await deleteDirectClient(duplicate.id);
        }
        
        totalMergedByAltegioId += duplicates.length;
        console.log(`[merge-duplicates-by-name] ✅ Merged ${duplicates.length} duplicates by altegioClientId ${altegioId}, kept client ${clientToKeep.id}`);
      }
    }
    
    // Оновлюємо список клієнтів після об'єднання за altegioClientId
    if (totalMergedByAltegioId > 0) {
      allClients = await getAllDirectClients();
      console.log(`[merge-duplicates-by-name] 📊 After merging by altegioClientId: ${totalMergedByAltegioId} duplicates merged, ${allClients.length} clients remaining`);
    }
    
    // КРОК 2: Групуємо клієнтів по імені + прізвище (оригінальна логіка)
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
    
    let totalMerged = totalMergedByAltegioId;
    
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

