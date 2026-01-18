// web/app/api/admin/direct/merge-duplicates-by-name/route.ts
// Об'єднання дублікатів клієнтів по імені та прізвищу

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { getStateHistory } from '@/lib/direct-state-log';
import { createNameComparisonKey, namesMatch } from '@/lib/name-normalize';
import { kvRead } from '@/lib/kv';
import { determineStateFromServices } from '@/lib/direct-state-helper';
import { prisma } from '@/lib/prisma';
import { getEnvValue } from '@/lib/env';
import { getClient as getAltegioClient } from '@/lib/altegio/clients';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isBadNamePart(v?: string | null): boolean {
  if (!v) return true;
  const t = String(v).trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (t.includes('{{') || t.includes('}}')) return true;
  if (lower === 'not found') return true;
  return false;
}

function looksInstagramSourced(firstName?: string | null, lastName?: string | null): boolean {
  const fn = String(firstName || '').trim();
  const ln = String(lastName || '').trim();
  if (!fn && !ln) return true;
  const isAllCapsSingle = !!fn && !ln && fn.length >= 3 && fn === fn.toUpperCase() && !/\s/.test(fn);
  return isAllCapsSingle;
}

function isAltegioGeneratedInstagram(username?: string | null): boolean {
  const u = String(username || '');
  return u.startsWith('missing_instagram_') || u.startsWith('altegio_') || u.startsWith('no_instagram_');
}

async function reassignHistory(fromClientId: string, toClientId: string) {
  // Важливо: перед видаленням дублікату переносимо історію, бо в БД стоїть ON DELETE CASCADE.
  const movedMessages = await prisma.directMessage.updateMany({
    where: { clientId: fromClientId },
    data: { clientId: toClientId },
  });
  const movedStateLogs = await prisma.directClientStateLog.updateMany({
    where: { clientId: fromClientId },
    data: { clientId: toClientId },
  });
  return { movedMessages: movedMessages.count, movedStateLogs: movedStateLogs.count };
}

async function applyNameFromAltegioIfPossible(directClientId: string, altegioClientId: number) {
  const companyIdStr = getEnvValue('ALTEGIO_COMPANY_ID');
  const companyId = companyIdStr ? Number(companyIdStr) : NaN;
  if (!Number.isFinite(companyId) || companyId <= 0) return { updated: false, reason: 'no_company_id' as const };
  try {
    const ac = await getAltegioClient(companyId, altegioClientId);
    if (!ac) return { updated: false, reason: 'not_found' as const };
    const fullName = String((ac as any).name || (ac as any).display_name || '').trim();
    if (!fullName) return { updated: false, reason: 'no_name' as const };
    const parts = fullName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || null;
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
    if (!firstName) return { updated: false, reason: 'no_first' as const };
    await prisma.directClient.update({
      where: { id: directClientId },
      data: { firstName, lastName, updatedAt: new Date() },
    });
    return { updated: true, reason: 'ok' as const };
  } catch (err) {
    console.warn('[merge-duplicates-by-name] ⚠️ Не вдалося підтягнути імʼя з Altegio API (не критично):', {
      altegioClientId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { updated: false, reason: 'error' as const };
  }
}

/**
 * Синхронізує стан клієнта на основі записів Altegio з KV storage
 */
async function syncClientStateFromAltegioRecords(clientId: string, altegioClientId: number): Promise<void> {
  try {
    // Отримуємо записи з KV storage
    const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
    
    // Фільтруємо записи для цього клієнта
    const clientRecords = recordsLogRaw
      .map((raw) => {
        try {
          let parsed: any;
          if (typeof raw === 'string') {
            parsed = JSON.parse(raw);
          } else {
            parsed = raw;
          }
          
          // Upstash може повертати елементи як { value: "..." }
          if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
            try {
              parsed = JSON.parse(parsed.value);
            } catch {
              return null;
            }
          }
          
          // Також перевіряємо, чи це не обгортка з data
          if (parsed && typeof parsed === 'object' && 'data' in parsed && !parsed.clientId) {
            parsed = parsed.data;
          }
          
          return parsed;
        } catch {
          return null;
        }
      })
      .filter((r) => {
        if (!r || typeof r !== 'object') return false;
        const recordClientId = r.clientId || (r.data && r.data.client && r.data.client.id);
        return parseInt(String(recordClientId), 10) === altegioClientId;
      })
      .filter((r) => {
        // Перевіряємо, чи є services
        return Array.isArray(r.services) || 
               (r.data && Array.isArray(r.data.services)) ||
               (r.data && r.data.service && typeof r.data.service === 'object');
      })
      .sort((a, b) => {
        const dateA = new Date(a.receivedAt || 0).getTime();
        const dateB = new Date(b.receivedAt || 0).getTime();
        return dateB - dateA; // Сортуємо за спаданням (найновіші спочатку)
      });

    if (clientRecords.length === 0) {
      return; // Немає записів
    }

    // Беремо останній запис
    const latestRecord = clientRecords[0];
    
    // Отримуємо services з різних можливих місць
    let services: any[] = [];
    if (latestRecord.data && Array.isArray(latestRecord.data.services)) {
      services = latestRecord.data.services;
    } else if (Array.isArray(latestRecord.services)) {
      services = latestRecord.services;
    } else if (latestRecord.data && latestRecord.data.service && typeof latestRecord.data.service === 'object') {
      services = [latestRecord.data.service];
    }

    if (!Array.isArray(services) || services.length === 0) {
      return;
    }

    // Визначаємо стан на основі послуг
    const newState = determineStateFromServices(services);
    
    if (!newState) {
      return; // Не вдалося визначити стан
    }
    
    // Отримуємо поточного клієнта
    const { getDirectClient, saveDirectClient } = await import('@/lib/direct-store');
    const client = await getDirectClient(clientId);
    
    if (!client) {
      return;
    }

    // Оновлюємо стан, якщо він змінився
    if (client.state !== newState) {
      const updated = {
        ...client,
        state: newState,
        updatedAt: new Date().toISOString(),
      };
      
      await saveDirectClient(updated, 'merge-duplicates-sync-state', {
        altegioClientId,
        services: services.map((s: any) => s.title || s.name),
      });
      
      console.log(`[merge-duplicates-by-name] ✅ Synced state for client ${clientId}: ${client.state || 'null'} → ${newState}`);
    }
  } catch (err) {
    console.error(`[merge-duplicates-by-name] Error syncing state for client ${clientId}:`, err);
    // Не викидаємо помилку, щоб не перервати об'єднання
  }
}

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
      // ПРАВИЛО: спираємось на Altegio (зберігаємо Altegio-клієнта), а з Instagram/Manychat беремо тільки Instagram username і історію повідомлень.
      let clientToKeep = clientsWithRecords[0].client;
      let keepHasRecords = clientsWithRecords[0].hasRecords;
      
      for (const { client, hasRecords } of clientsWithRecords) {
        const keepIsFromAltegio = Boolean(clientToKeep.altegioClientId) || isAltegioGeneratedInstagram(clientToKeep.instagramUsername);
        const currentIsFromAltegio = Boolean(client.altegioClientId) || isAltegioGeneratedInstagram(client.instagramUsername);
        
        // Пріоритет: клієнт з Altegio (missing_instagram_*)
        if (!keepIsFromAltegio && currentIsFromAltegio) {
          clientToKeep = client;
          keepHasRecords = hasRecords;
          continue;
        }
        
        // Якщо обидва з Altegio або обидва не з Altegio
        if (keepIsFromAltegio === currentIsFromAltegio) {
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
          // Переносимо Instagram, якщо він "людський" (не missing_instagram_/no_instagram_)
          if (updatedClient.instagramUsername.startsWith('missing_instagram_') && 
              !duplicate.instagramUsername.startsWith('missing_instagram_')) {
            updatedClient.instagramUsername = duplicate.instagramUsername;
          }

          // Якщо у дублікаті є історія повідомлень/станів — переносимо на клієнта, якого залишаємо (щоб не втратити при delete cascade).
          try {
            const moved = await reassignHistory(duplicate.id, updatedClient.id);
            if (moved.movedMessages || moved.movedStateLogs) {
              console.log(
                `[merge-duplicates-by-name] ✅ Перенесено історію з ${duplicate.id} → ${updatedClient.id}: messages=${moved.movedMessages}, stateLogs=${moved.movedStateLogs}`
              );
            }
          } catch (err) {
            console.warn('[merge-duplicates-by-name] ⚠️ Не вдалося перенести історію повідомлень/станів (не критично):', err);
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

        // Після злиття: пріоритезуємо імʼя з Altegio API, якщо поточне виглядає як інстаграмне/плейсхолдер.
        if (
          updatedClient.altegioClientId &&
          (isBadNamePart(updatedClient.firstName) ||
            isBadNamePart(updatedClient.lastName) ||
            looksInstagramSourced(updatedClient.firstName, updatedClient.lastName))
        ) {
          const res = await applyNameFromAltegioIfPossible(updatedClient.id, updatedClient.altegioClientId);
          console.log(
            `[merge-duplicates-by-name] 🧾 Спроба виправити імʼя з Altegio API: updated=${res.updated} reason=${res.reason} (altegioClientId=${updatedClient.altegioClientId})`
          );
        }
        
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
    
    // КРОК 2: Групуємо клієнтів по імені + прізвище з нормалізацією (українська ↔ англійська)
    const clientsByName = new Map<string, typeof allClients>();
    
    for (const client of allClients) {
      const firstName = client.firstName || '';
      const lastName = client.lastName || '';
      
      if (firstName && lastName) {
        // Використовуємо нормалізований ключ (транслітерація)
        const nameKey = createNameComparisonKey(firstName, lastName).normalized;
        if (!nameKey) continue; // Пропускаємо, якщо нормалізація не вдалась
        
        if (!clientsByName.has(nameKey)) {
          clientsByName.set(nameKey, []);
        }
        clientsByName.get(nameKey)!.push(client);
      }
    }
    
    console.log(`[merge-duplicates-by-name] 🔍 After name normalization: ${clientsByName.size} name groups`);
    
    // Діагностика: показуємо приклади груп з кількома клієнтами
    let diagnosticShown = 0;
    for (const [nameKey, clients] of clientsByName.entries()) {
      if (clients.length > 1 && diagnosticShown < 5) {
        console.log(`[merge-duplicates-by-name] 🔍 Name group "${nameKey}" has ${clients.length} clients:`, 
          clients.map(c => `${c.firstName} ${c.lastName} (${c.instagramUsername}, altegioClientId: ${c.altegioClientId || 'none'})`));
        diagnosticShown++;
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
      // ПРАВИЛО: залишаємо клієнта з Altegio (має altegioClientId або missing_instagram_*), 
      // а Instagram username та інші дані беремо з клієнта Manychat
      // Пріоритет:
      // 1. Клієнт з Altegio (має altegioClientId або missing_instagram_*)
      // 2. Клієнт з записями (state logs, дати)
      // 3. Найновіший клієнт
      
      let clientToKeep = clientsWithRecords[0].client;
      let keepHasRecords = clientsWithRecords[0].hasRecords;
      
      // Функція для визначення, чи клієнт з Altegio
      const isFromAltegio = (client: typeof clientToKeep) => {
        return client.altegioClientId !== undefined && client.altegioClientId !== null ||
               client.instagramUsername.startsWith('missing_instagram_');
      };
      
      for (const { client, hasRecords } of clientsWithRecords) {
        const keepIsFromAltegio = isFromAltegio(clientToKeep);
        const currentIsFromAltegio = isFromAltegio(client);
        
        // Пріоритет: клієнт з Altegio
        if (!keepIsFromAltegio && currentIsFromAltegio) {
          clientToKeep = client;
          keepHasRecords = hasRecords;
          continue;
        }
        
        // Якщо обидва з Altegio або обидва не з Altegio
        if (keepIsFromAltegio === currentIsFromAltegio) {
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
        
        // Синхронізуємо стан на основі записів Altegio
        if (updatedClient.altegioClientId) {
          try {
            await syncClientStateFromAltegioRecords(updatedClient.id, updatedClient.altegioClientId);
          } catch (err) {
            console.error(`[merge-duplicates-by-name] Failed to sync state for client ${updatedClient.id}:`, err);
          }
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

