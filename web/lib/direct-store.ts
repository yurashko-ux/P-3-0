// web/lib/direct-store.ts
// Функції для роботи з Direct клієнтами та статусами в Prisma Postgres

import { prisma } from './prisma';
import type { DirectClient, DirectStatus } from './direct-types';
import { normalizeInstagram } from './normalize';
import { logStateChange } from './direct-state-log';

// Конвертація з Prisma моделі в DirectClient
function prismaClientToDirectClient(dbClient: any): DirectClient {
  return {
    id: dbClient.id,
    instagramUsername: dbClient.instagramUsername,
    firstName: dbClient.firstName || undefined,
    lastName: dbClient.lastName || undefined,
    phone: dbClient.phone || undefined,
    spent: dbClient.spent ?? undefined,
    visits: dbClient.visits ?? undefined,
    source: (dbClient.source as 'instagram' | 'tiktok' | 'other') || 'instagram',
    state: (dbClient.state as 'lead' | 'client' | 'consultation' | 'consultation-booked' | 'consultation-no-show' | 'consultation-rescheduled' | 'hair-extension' | 'other-services' | 'all-good' | 'too-expensive' | 'message') || undefined,
    firstContactDate: dbClient.firstContactDate.toISOString(),
    statusId: dbClient.statusId,
    masterId: dbClient.masterId || undefined,
    masterManuallySet: dbClient.masterManuallySet ?? false, // Використовуємо ?? для безпечної обробки null/undefined
    consultationDate: dbClient.consultationDate?.toISOString() || undefined,
    visitedSalon: dbClient.visitedSalon || false,
    visitDate: dbClient.visitDate?.toISOString() || undefined,
    signedUpForPaidService: dbClient.signedUpForPaidService || false,
    paidServiceDate: dbClient.paidServiceDate?.toISOString() || undefined,
    paidServiceAttended: dbClient.paidServiceAttended ?? null,
    paidServiceCancelled: dbClient.paidServiceCancelled ?? false,
    paidServiceTotalCost: dbClient.paidServiceTotalCost ?? undefined,
    signupAdmin: dbClient.signupAdmin || undefined,
    comment: dbClient.comment || undefined,
    altegioClientId: dbClient.altegioClientId || undefined,
    lastMessageAt: dbClient.lastMessageAt?.toISOString() || undefined,
    consultationBookingDate: dbClient.consultationBookingDate?.toISOString() || undefined,
    consultationAttended: dbClient.consultationAttended ?? null,
    consultationCancelled: dbClient.consultationCancelled ?? false,
    consultationMasterId: dbClient.consultationMasterId || undefined,
    consultationMasterName: dbClient.consultationMasterName || undefined,
    serviceMasterAltegioStaffId: dbClient.serviceMasterAltegioStaffId ?? undefined,
    serviceMasterName: dbClient.serviceMasterName || undefined,
    serviceMasterHistory: dbClient.serviceMasterHistory || undefined,
    isOnlineConsultation: dbClient.isOnlineConsultation || false,
    signedUpForPaidServiceAfterConsultation: dbClient.signedUpForPaidServiceAfterConsultation || false,
    telegramNotificationSent: dbClient.telegramNotificationSent ?? false,
    createdAt: dbClient.createdAt.toISOString(),
    updatedAt: dbClient.updatedAt.toISOString(),
  };
}

// Конвертація з DirectClient в Prisma модель
function directClientToPrisma(client: DirectClient) {
  return {
    id: client.id,
    instagramUsername: client.instagramUsername.toLowerCase().trim(),
    firstName: client.firstName || null,
    lastName: client.lastName || null,
    phone: client.phone || null,
    spent: client.spent ?? null,
    visits: client.visits ?? null,
    source: client.source || 'instagram',
    state: client.state || null,
    firstContactDate: new Date(client.firstContactDate),
    statusId: client.statusId,
    masterId: client.masterId || null,
    masterManuallySet: client.masterManuallySet ?? false, // Використовуємо ?? для безпечної обробки
    consultationDate: client.consultationDate ? new Date(client.consultationDate) : null,
    visitedSalon: client.visitedSalon || false,
    visitDate: client.visitDate ? new Date(client.visitDate) : null,
    signedUpForPaidService: client.signedUpForPaidService || false,
    paidServiceDate: client.paidServiceDate ? new Date(client.paidServiceDate) : null,
    paidServiceAttended: client.paidServiceAttended ?? null,
    paidServiceCancelled: client.paidServiceCancelled ?? false,
    paidServiceTotalCost: client.paidServiceTotalCost ?? null,
    signupAdmin: client.signupAdmin || null,
    comment: client.comment || null,
    altegioClientId: client.altegioClientId || null,
    lastMessageAt: client.lastMessageAt ? new Date(client.lastMessageAt) : null,
    consultationBookingDate: client.consultationBookingDate ? new Date(client.consultationBookingDate) : null,
    consultationAttended: client.consultationAttended ?? null,
    consultationCancelled: client.consultationCancelled ?? false,
    consultationMasterId: client.consultationMasterId || null,
    consultationMasterName: client.consultationMasterName || null,
    serviceMasterAltegioStaffId: client.serviceMasterAltegioStaffId ?? null,
    serviceMasterName: client.serviceMasterName || null,
    serviceMasterHistory: client.serviceMasterHistory || null,
    isOnlineConsultation: client.isOnlineConsultation || false,
    signedUpForPaidServiceAfterConsultation: client.signedUpForPaidServiceAfterConsultation || false,
    telegramNotificationSent: client.telegramNotificationSent ?? false,
  };
}

// Конвертація з Prisma моделі в DirectStatus
function prismaStatusToDirectStatus(dbStatus: any): DirectStatus {
  return {
    id: dbStatus.id,
    name: dbStatus.name,
    color: dbStatus.color,
    order: dbStatus.order,
    isDefault: dbStatus.isDefault || false,
    createdAt: dbStatus.createdAt.toISOString(),
  };
}

// Конвертація з DirectStatus в Prisma модель
function directStatusToPrisma(status: DirectStatus) {
  return {
    id: status.id,
    name: status.name,
    color: status.color,
    order: status.order,
    isDefault: status.isDefault || false,
  };
}

/**
 * Отримати всіх клієнтів
 */
export async function getAllDirectClients(): Promise<DirectClient[]> {
  try {
    // Перевіряємо підключення до бази даних
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (connectionErr: any) {
      const connectionErrorCode = connectionErr?.code || (connectionErr as any)?.code;
      const connectionErrorMessage = connectionErr?.message || String(connectionErr);
      
      // Якщо помилка досягнення ліміту плану Prisma (P6003) - повертаємо порожній масив
      if (connectionErrorCode === 'P6003' || 
          connectionErrorCode === 'P5000' ||
          connectionErrorMessage?.includes('planLimitReached') ||
          connectionErrorMessage?.includes('hold on your account')) {
        console.error('[direct-store] ⚠️ Prisma plan limit reached:', connectionErrorMessage);
        return [];
      }
      
      // Якщо помилка підключення - повертаємо порожній масив
      if (connectionErrorMessage?.includes("Can't reach database server") || 
          connectionErr?.name === 'PrismaClientInitializationError') {
        console.error('[direct-store] Database connection error:', connectionErrorMessage);
        return [];
      }
      throw connectionErr;
    }
    
    // Спочатку перевіряємо, чи існує колонка masterManuallySet
    try {
      await prisma.$queryRaw`SELECT "masterManuallySet" FROM "direct_clients" LIMIT 1`;
    } catch (columnErr) {
      // Якщо колонки немає - додаємо її
      if (columnErr instanceof Error && (
        columnErr.message.includes('masterManuallySet') ||
        columnErr.message.includes('column') ||
        columnErr.message.includes('does not exist')
      )) {
        console.log('[direct-store] Column masterManuallySet missing, adding it...');
        try {
          await prisma.$executeRawUnsafe(`
            ALTER TABLE "direct_clients" 
            ADD COLUMN IF NOT EXISTS "masterManuallySet" BOOLEAN NOT NULL DEFAULT false;
          `);
          console.log('[direct-store] ✅ Column masterManuallySet added successfully');
        } catch (addErr) {
          console.error('[direct-store] Failed to add column:', addErr);
          // Продовжуємо - спробуємо завантажити без цього поля
        }
      }
    }

    const clients = await prisma.directClient.findMany({
      orderBy: { createdAt: 'desc' },
    });
    console.log(`[direct-store] Found ${clients.length} clients in database`);
    const convertedClients = clients.map(prismaClientToDirectClient);
    console.log(`[direct-store] Converted ${convertedClients.length} clients`);
    return convertedClients;
  } catch (err: any) {
    console.error('[direct-store] Failed to get all clients:', err);
    // Додаємо детальну інформацію про помилку
    const errorCode = err?.code || (err as any)?.code;
    const errorMessage = err?.message || (err instanceof Error ? err.message : String(err));
    
    if (err instanceof Error || err) {
      console.error('[direct-store] Error details:', {
        message: errorMessage,
        stack: err?.stack,
        name: err?.name,
        code: errorCode,
      });
      
      // Якщо це помилка досягнення ліміту плану Prisma (P6003) - повертаємо порожній масив
      if (errorCode === 'P6003' || 
          errorCode === 'P5000' ||
          errorMessage?.includes('planLimitReached') ||
          errorMessage?.includes('hold on your account')) {
        console.error('[direct-store] ⚠️ Prisma plan limit reached - returning empty array');
        return [];
      }
      
      // Якщо це помилка підключення до бази даних - повертаємо порожній масив
      if (errorMessage?.includes('Can\'t reach database server') || 
          errorMessage?.includes('database server') ||
          err?.name === 'PrismaClientInitializationError') {
        console.error('[direct-store] ⚠️ Database connection error - returning empty array');
        return [];
      }
    }
    // Якщо помилка через відсутнє поле - спробуємо завантажити через SQL без цього поля
    if (err instanceof Error && (
      err.message.includes('masterManuallySet') ||
      err.message.includes('column') ||
      err.message.includes('does not exist')
    )) {
      console.log('[direct-store] Attempting to load clients via raw SQL (without masterManuallySet)...');
      try {
        const rawClients = await prisma.$queryRawUnsafe<Array<any>>(
          'SELECT * FROM direct_clients ORDER BY "createdAt" DESC'
        );
        console.log(`[direct-store] Found ${rawClients.length} clients via raw SQL`);
        // Конвертуємо вручну, додаючи masterManuallySet = false
        return rawClients.map((dbClient: any) => ({
          id: dbClient.id,
          instagramUsername: dbClient.instagramUsername,
          firstName: dbClient.firstName || undefined,
          lastName: dbClient.lastName || undefined,
          phone: dbClient.phone || undefined,
          source: (dbClient.source as 'instagram' | 'tiktok' | 'other') || 'instagram',
          state: (dbClient.state as 'lead' | 'client' | 'consultation') || undefined,
          firstContactDate: dbClient.firstContactDate.toISOString(),
          statusId: dbClient.statusId,
          masterId: dbClient.masterId || undefined,
          masterManuallySet: false, // Значення за замовчуванням
          consultationDate: dbClient.consultationDate?.toISOString() || undefined,
          visitedSalon: dbClient.visitedSalon || false,
          visitDate: dbClient.visitDate?.toISOString() || undefined,
          signedUpForPaidService: dbClient.signedUpForPaidService || false,
          paidServiceDate: dbClient.paidServiceDate?.toISOString() || undefined,
          signupAdmin: dbClient.signupAdmin || undefined,
          comment: dbClient.comment || undefined,
          altegioClientId: dbClient.altegioClientId || undefined,
          lastMessageAt: dbClient.lastMessageAt?.toISOString() || undefined,
          createdAt: dbClient.createdAt.toISOString(),
          updatedAt: dbClient.updatedAt.toISOString(),
        }));
      } catch (sqlErr) {
        console.error('[direct-store] Raw SQL also failed:', sqlErr);
      }
    }
    return [];
  }
}

/**
 * Отримати клієнта за ID
 */
export async function getDirectClient(id: string): Promise<DirectClient | null> {
  try {
    const client = await prisma.directClient.findUnique({
      where: { id },
    });
    return client ? prismaClientToDirectClient(client) : null;
  } catch (err) {
    console.error(`[direct-store] Failed to get client ${id}:`, err);
    return null;
  }
}

/**
 * Отримати клієнта за Instagram username
 */
export async function getDirectClientByInstagram(username: string): Promise<DirectClient | null> {
  try {
    const normalized = normalizeInstagram(username);
    if (!normalized) return null;
    
    const client = await prisma.directClient.findUnique({
      where: { instagramUsername: normalized },
    });
    return client ? prismaClientToDirectClient(client) : null;
  } catch (err) {
    console.error(`[direct-store] Failed to get client by Instagram ${username}:`, err);
    return null;
  }
}

/**
 * Отримати клієнта за Altegio client ID
 */
export async function getDirectClientByAltegioId(altegioClientId: number): Promise<DirectClient | null> {
  try {
    const client = await prisma.directClient.findFirst({
      where: { altegioClientId },
    });
    return client ? prismaClientToDirectClient(client) : null;
  } catch (err) {
    console.error(`[direct-store] Failed to get client by Altegio ID ${altegioClientId}:`, err);
    return null;
  }
}

/**
 * Оновити Instagram username для клієнта з відомим Altegio client ID
 */
export async function updateInstagramForAltegioClient(
  altegioClientId: number,
  instagramUsername: string
): Promise<DirectClient | null> {
  console.log(`[direct-store] 🔥🔥🔥 updateInstagramForAltegioClient CALLED - VERSION 2025-12-28-1635 🔥🔥🔥`);
  try {
    const normalized = normalizeInstagram(instagramUsername);
    if (!normalized) {
      console.error(`[direct-store] Invalid Instagram username: ${instagramUsername}`);
      return null;
    }

    // Знаходимо клієнта за altegioClientId
    const existingClient = await prisma.directClient.findFirst({
      where: { altegioClientId },
    });

    if (!existingClient) {
      console.error(`[direct-store] Client with Altegio ID ${altegioClientId} not found`);
      return null;
    }

    // Перевіряємо, чи не існує вже клієнт з таким Instagram username
    // Використовуємо findFirst, бо findUnique може не спрацювати через проблеми з індексом
    const existingByInstagram = await prisma.directClient.findFirst({
      where: { instagramUsername: normalized },
    });

    console.log(`[direct-store] 🔍 Checking for existing client with Instagram "${normalized}":`, existingByInstagram ? {
      id: existingByInstagram.id,
      instagramUsername: existingByInstagram.instagramUsername,
      altegioClientId: existingByInstagram.altegioClientId,
      state: existingByInstagram.state,
    } : 'NOT FOUND');
    console.log(`[direct-store] 🔍 Current client (by Altegio ID):`, {
      id: existingClient.id,
      instagramUsername: existingClient.instagramUsername,
      altegioClientId: existingClient.altegioClientId,
      state: existingClient.state,
    });
    console.log(`[direct-store] 🔍 Are they different? ${existingByInstagram ? (existingByInstagram.id !== existingClient.id) : 'N/A'}`);

    // Завжди оновлюємо стан на 'client', якщо клієнт мав missing_instagram_* username
    const previousState = existingClient.state;
    
    // ВАЖЛИВО: Спочатку перевіряємо, чи існує клієнт з таким Instagram username
    // Якщо так, об'єднуємо їх ПЕРЕД спробою оновлення
    if (existingByInstagram && existingByInstagram.id !== existingClient.id) {
      // Якщо існує інший клієнт з таким Instagram, об'єднуємо їх:
      // Оновлюємо Altegio ID в існуючому клієнті з правильним Instagram (якщо його немає)
      // Видаляємо поточного клієнта з неправильним Instagram
      console.log(`[direct-store] ⚠️ Instagram ${normalized} already exists for client ${existingByInstagram.id}, merging clients...`);
      
      // Оновлюємо існуючого клієнта з правильним Instagram (додаємо Altegio ID, якщо його немає)
      const mergeUpdateData: any = {
      updatedAt: new Date(),
    };
    
      const wasAddingAltegioId = !existingByInstagram.altegioClientId && altegioClientId;
      if (wasAddingAltegioId) {
        mergeUpdateData.altegioClientId = altegioClientId;
        console.log(`[direct-store] Adding Altegio ID ${altegioClientId} to existing client ${existingByInstagram.id}`);
      }
      
      // Переносимо firstName/lastName з клієнта з Altegio (existingClient) до клієнта з Manychat (existingByInstagram)
      // Завжди віддаємо перевагу даним з Altegio - якщо в Altegio клієнта є ім'я, використовуємо його
      if (existingClient.firstName && existingClient.firstName.trim() !== '') {
        mergeUpdateData.firstName = existingClient.firstName;
        if (existingClient.firstName !== existingByInstagram.firstName) {
          console.log(`[direct-store] Merging: overriding firstName with Altegio value "${existingClient.firstName}" (was: "${existingByInstagram.firstName || 'empty'}")`);
        }
      }
      if (existingClient.lastName && existingClient.lastName.trim() !== '') {
        mergeUpdateData.lastName = existingClient.lastName;
        if (existingClient.lastName !== existingByInstagram.lastName) {
          console.log(`[direct-store] Merging: overriding lastName with Altegio value "${existingClient.lastName}" (was: "${existingByInstagram.lastName || 'empty'}")`);
        }
      }
      
      // Оновлюємо стан:
      // 1. Якщо клієнт мав missing_instagram_* username і ми додаємо реальний Instagram → 'client'
      // 2. Якщо клієнт мав стан 'lead' і ми додаємо Altegio ID → 'client' (бо клієнт тепер в Altegio)
      const hadMissingInstagram = existingByInstagram.instagramUsername?.startsWith('missing_instagram_');
      if (hadMissingInstagram) {
        mergeUpdateData.state = 'client';
        console.log(`[direct-store] Updating state to 'client' for merged client ${existingByInstagram.id} (had missing_instagram_*, now has real Instagram)`);
      } else if (existingByInstagram.state === 'lead' && wasAddingAltegioId) {
        mergeUpdateData.state = 'client';
        console.log(`[direct-store] Updating state from 'lead' to 'client' for merged client ${existingByInstagram.id} (added Altegio ID)`);
      }
      
      // Оновлюємо існуючого клієнта з правильним Instagram
      const updated = await prisma.directClient.update({
        where: { id: existingByInstagram.id },
        data: mergeUpdateData,
      });
      
      // Видаляємо поточного клієнта з неправильним Instagram (той, що був створений з 'missing_instagram_*')
      console.log(`[direct-store] Deleting duplicate client ${existingClient.id} (had missing_instagram_* username)`);
      await prisma.directClient.delete({
        where: { id: existingClient.id },
      });
      
      // Логуємо зміну стану, якщо вона відбулася (якщо клієнт мав missing_instagram_* і тепер має реальний Instagram)
      if (hadMissingInstagram && updated.state === 'client') {
        await logStateChange(
          existingByInstagram.id,
          'client',
          existingByInstagram.state || 'lead',
          'instagram-update-merge',
          {
            altegioClientId,
            instagramUsername: normalized,
            source: 'telegram-reply',
            mergedClientId: existingClient.id,
          }
        );
      }
      
      const result = prismaClientToDirectClient(updated);
      console.log(`[direct-store] ✅ Merged clients: kept ${existingByInstagram.id}, deleted ${existingClient.id}`);
      console.log(`[direct-store] 📊 Final state: ${result.state}`);
      return result;
    } else {
      // Просто оновлюємо Instagram username (немає конфлікту)
      const updateData: any = {
        instagramUsername: normalized,
        updatedAt: new Date(),
      };
      
      // Якщо клієнт мав missing_instagram_* username і ми оновлюємо на реальний Instagram, оновлюємо стан на 'client'
      const hadMissingInstagram = existingClient.instagramUsername?.startsWith('missing_instagram_');
      if (hadMissingInstagram) {
        updateData.state = 'client';
        console.log(`[direct-store] Updating state to 'client' for client ${existingClient.id} (had missing_instagram_*, now has real Instagram)`);
      }
      
      try {
      const updated = await prisma.directClient.update({
        where: { id: existingClient.id },
        data: updateData,
      });
      
      // Логуємо зміну стану, якщо вона відбулася
        if (hadMissingInstagram && updated.state === 'client') {
        await logStateChange(
          existingClient.id,
          'client',
            previousState || 'lead',
          'instagram-update',
          {
            altegioClientId,
            instagramUsername: normalized,
            source: 'telegram-reply',
          }
        );
      }
      
      const result = prismaClientToDirectClient(updated);
      console.log(`[direct-store] ✅ Updated Instagram for client ${existingClient.id} (Altegio ID: ${altegioClientId}) to ${normalized}`);
      console.log(`[direct-store] 📊 State after update: ${result.state} (was: ${previousState})`);
      return result;
      } catch (updateErr: any) {
        // Якщо виникла помилка unique constraint, спробуємо об'єднати клієнтів
        if (updateErr?.code === 'P2002' && updateErr?.meta?.target?.includes('instagramUsername')) {
          console.log(`[direct-store] ⚠️ Unique constraint error detected, trying to find and merge existing client with Instagram "${normalized}"`);
          
          // Шукаємо клієнта з таким Instagram username
          const existingByInstagramRetry = await prisma.directClient.findFirst({
            where: { instagramUsername: normalized },
          });
          
          if (existingByInstagramRetry && existingByInstagramRetry.id !== existingClient.id) {
            console.log(`[direct-store] ⚠️ Found existing client ${existingByInstagramRetry.id} with Instagram "${normalized}", merging...`);
            
            // Об'єднуємо клієнтів
            const mergeUpdateData: any = {
              updatedAt: new Date(),
            };
            
            const wasAddingAltegioId = !existingByInstagramRetry.altegioClientId && altegioClientId;
            if (wasAddingAltegioId) {
              mergeUpdateData.altegioClientId = altegioClientId;
              console.log(`[direct-store] Adding Altegio ID ${altegioClientId} to existing client ${existingByInstagramRetry.id}`);
            }
            
            // Переносимо firstName/lastName з клієнта з Altegio (existingClient) до клієнта з Manychat (existingByInstagramRetry)
            // Завжди віддаємо перевагу даним з Altegio
            if (existingClient.firstName && existingClient.firstName.trim() !== '') {
              mergeUpdateData.firstName = existingClient.firstName;
              if (existingClient.firstName !== existingByInstagramRetry.firstName) {
                console.log(`[direct-store] Merging (fallback): overriding firstName with Altegio value "${existingClient.firstName}" (was: "${existingByInstagramRetry.firstName || 'empty'}")`);
              }
            }
            if (existingClient.lastName && existingClient.lastName.trim() !== '') {
              mergeUpdateData.lastName = existingClient.lastName;
              if (existingClient.lastName !== existingByInstagramRetry.lastName) {
                console.log(`[direct-store] Merging (fallback): overriding lastName with Altegio value "${existingClient.lastName}" (was: "${existingByInstagramRetry.lastName || 'empty'}")`);
              }
            }
            
            const hadMissingInstagramRetry = existingByInstagramRetry.instagramUsername?.startsWith('missing_instagram_');
            if (hadMissingInstagramRetry) {
              mergeUpdateData.state = 'client';
              console.log(`[direct-store] Updating state to 'client' for merged client ${existingByInstagramRetry.id} (had missing_instagram_*, now has real Instagram)`);
            } else if (existingByInstagramRetry.state === 'lead' && wasAddingAltegioId) {
              mergeUpdateData.state = 'client';
              console.log(`[direct-store] Updating state from 'lead' to 'client' for merged client ${existingByInstagramRetry.id} (added Altegio ID)`);
            }
            
            const updated = await prisma.directClient.update({
              where: { id: existingByInstagramRetry.id },
              data: mergeUpdateData,
            });
            
            console.log(`[direct-store] Deleting duplicate client ${existingClient.id} (had missing_instagram_* username)`);
            await prisma.directClient.delete({
              where: { id: existingClient.id },
            });
            
            if (hadMissingInstagramRetry && updated.state === 'client') {
              await logStateChange(
                existingByInstagramRetry.id,
                'client',
                existingByInstagramRetry.state || 'lead',
                'instagram-update-merge',
                {
                  altegioClientId,
                  instagramUsername: normalized,
                  source: 'telegram-reply',
                  mergedClientId: existingClient.id,
                }
              );
            }
            
            const result = prismaClientToDirectClient(updated);
            console.log(`[direct-store] ✅ Merged clients after unique constraint error: kept ${existingByInstagramRetry.id}, deleted ${existingClient.id}`);
            console.log(`[direct-store] 📊 Final state: ${result.state}`);
            return result;
          }
        }
        
        // Якщо це не помилка unique constraint або не знайшли клієнта, прокидаємо помилку далі
        throw updateErr;
      }
    }
  } catch (err) {
    console.error(`[direct-store] Failed to update Instagram for Altegio client ${altegioClientId}:`, err);
    return null;
  }
}

/**
 * Перевіряє, чи клієнт вже мав стан "lead" в історії
 */
async function hasLeadStateInHistory(clientId: string): Promise<boolean> {
  try {
    const { getStateHistory } = await import('@/lib/direct-state-log');
    const history = await getStateHistory(clientId);
    return history.some(log => log.state === 'lead');
  } catch (err) {
    console.warn(`[direct-store] Failed to check lead state history for ${clientId}:`, err);
    return false; // У разі помилки дозволяємо встановлення "lead"
  }
}

/**
 * Перевіряє, чи клієнт вже мав стан "client" в історії
 */
async function hasClientStateInHistory(clientId: string): Promise<boolean> {
  try {
    const { getStateHistory } = await import('@/lib/direct-state-log');
    const history = await getStateHistory(clientId);
    return history.some(log => log.state === 'client');
  } catch (err) {
    console.warn(`[direct-store] Failed to check client state history for ${clientId}:`, err);
    return false; // У разі помилки дозволяємо встановлення "client"
  }
}

/**
 * Зберегти клієнта
 */
export async function saveDirectClient(
  client: DirectClient,
  reason?: string,
  metadata?: Record<string, any>,
  skipLoggingOrOptions?: boolean | { skipLogging?: boolean; touchUpdatedAt?: boolean }
): Promise<void> {
  try {
    const options =
      typeof skipLoggingOrOptions === 'object' && skipLoggingOrOptions
        ? skipLoggingOrOptions
        : { skipLogging: Boolean(skipLoggingOrOptions) };
    const skipLogging = Boolean((options as any).skipLogging);
    // За замовчуванням updatedAt “торкаємо”.
    // Для admin/backfill/UI-правок передаємо touchUpdatedAt=false, щоб таблиця не “пливла”.
    const touchUpdatedAt = (options as any).touchUpdatedAt !== false;

    const data = directClientToPrisma(client);
    const normalizedUsername = data.instagramUsername;
    
    // ПРАВИЛО 1: Клієнти з Altegio не можуть мати стан "lead"
    // ПРАВИЛО 2: Клієнт не може мати стан "lead" більше одного разу
    // ПРАВИЛО 3: Клієнт не може мати стан "client" більше одного разу (для Altegio клієнтів)
    type DirectClientState = 'lead' | 'client' | 'consultation' | 'consultation-booked' | 'consultation-no-show' | 'consultation-rescheduled' | 'hair-extension' | 'other-services' | 'all-good' | 'too-expensive' | 'message';
    let finalState: DirectClientState | undefined = client.state;
    
    // Перевіряємо, чи клієнт має altegioClientId (поточний або в базі)
    const existingClientCheck = await prisma.directClient.findFirst({
      where: {
        OR: [
          { id: client.id },
          { instagramUsername: normalizedUsername },
        ],
      },
      select: { id: true, altegioClientId: true, state: true },
    });
    
    const hasAltegioId = existingClientCheck?.altegioClientId || data.altegioClientId;
    
    if (finalState === 'lead') {
      if (hasAltegioId) {
        // Клієнт з Altegio не може бути "lead"
        finalState = 'client';
        console.log(`[direct-store] ⚠️ Client ${existingClientCheck?.id || client.id} has altegioClientId, changing state from 'lead' to 'client'`);
      } else if (existingClientCheck) {
        // Перевіряємо, чи клієнт вже мав стан "lead" в історії
        const hadLeadBefore = await hasLeadStateInHistory(existingClientCheck.id);
        if (hadLeadBefore) {
          // Клієнт вже мав стан "lead", не дозволяємо встановити його знову
          const currentState = existingClientCheck.state as DirectClientState | null;
          finalState = (currentState && ['lead', 'client', 'consultation', 'hair-extension', 'other-services', 'all-good', 'too-expensive'].includes(currentState)) 
            ? currentState 
            : 'client';
          console.log(`[direct-store] ⚠️ Client ${existingClientCheck.id} already had 'lead' state in history, keeping current state: ${finalState}`);
        }
      }
    } else if (finalState === 'client' && hasAltegioId) {
      // Для Altegio клієнтів: стан "client" встановлюється тільки один раз
      if (existingClientCheck) {
        const hadClientBefore = await hasClientStateInHistory(existingClientCheck.id);
        if (hadClientBefore) {
          // Клієнт вже мав стан "client", не встановлюємо його знову
          // Зберігаємо поточний стан клієнта
          const currentState = existingClientCheck.state as DirectClientState | null;
          finalState = (currentState && ['client', 'consultation', 'consultation-booked', 'consultation-no-show', 'consultation-rescheduled', 'hair-extension', 'other-services', 'all-good', 'too-expensive', 'message'].includes(currentState)) 
            ? currentState 
            : 'client';
          console.log(`[direct-store] ⚠️ Client ${existingClientCheck.id} already had 'client' state in history (Altegio client), keeping current state: ${finalState}`);
        }
      }
    }
    
    // Оновлюємо стан клієнта
    const clientWithCorrectState = { ...client, state: finalState };
    const dataWithCorrectState = directClientToPrisma(clientWithCorrectState);
    
    // Спочатку перевіряємо, чи існує клієнт з таким instagramUsername
    const existingByUsername = await prisma.directClient.findUnique({
      where: { instagramUsername: normalizedUsername },
    });
    
    let previousState: string | null | undefined = null;
    let clientIdForLog = client.id;
    
    if (existingByUsername) {
      previousState = existingByUsername.state;
      clientIdForLog = existingByUsername.id;
      
      // Якщо існує клієнт з таким username, оновлюємо його (об'єднуємо дані)
      // Беремо найранішу дату створення та найпізнішу дату оновлення
      await prisma.directClient.update({
        where: { instagramUsername: normalizedUsername },
        data: {
          ...dataWithCorrectState,
          id: existingByUsername.id, // Зберігаємо існуючий ID
          createdAt: existingByUsername.createdAt < data.firstContactDate 
            ? existingByUsername.createdAt 
            : new Date(data.firstContactDate),
          ...(touchUpdatedAt ? { updatedAt: new Date() } : {}),
        },
      });
      console.log(`[direct-store] ✅ Updated existing client ${existingByUsername.id} (username: ${normalizedUsername})`);
    } else {
      // Перевіряємо, чи існує клієнт з таким ID
      const existingById = await prisma.directClient.findUnique({
        where: { id: client.id },
      });
      
      if (existingById) {
        previousState = existingById.state;
        
        // Оновлюємо існуючий запис
        await prisma.directClient.update({
          where: { id: client.id },
          data: {
            ...dataWithCorrectState,
            ...(touchUpdatedAt ? { updatedAt: new Date() } : {}),
          },
        });
        console.log(`[direct-store] ✅ Updated client ${client.id} to Postgres`);
      } else {
        // Створюємо новий запис (для нового клієнта previousState = null)
        await prisma.directClient.create({
          data: dataWithCorrectState,
        });
        console.log(`[direct-store] ✅ Created client ${client.id} to Postgres`);
      }
    }
    
    // Якщо встановлюється altegioClientId, перевіряємо старі вебхуки для синхронізації дат та станів
    if (data.altegioClientId && (!data.paidServiceDate || !data.consultationBookingDate || client.state === 'client' || client.state === 'lead')) {
      const existingClientAfterSave = await prisma.directClient.findFirst({
        where: {
          OR: [
            { id: client.id },
            { instagramUsername: normalizedUsername },
          ],
        },
        select: { 
          id: true, 
          altegioClientId: true, 
          paidServiceDate: true, 
          consultationBookingDate: true,
          state: true,
        },
      });

      if (existingClientAfterSave && existingClientAfterSave.altegioClientId) {
        // Асинхронно перевіряємо старі вебхуки (не блокуємо збереження)
        setImmediate(async () => {
          try {
            const { kvRead } = await import('@/lib/kv');
            const { determineStateFromServices } = await import('@/lib/direct-state-helper');
            const rawItems = await kvRead.lrange('altegio:records:log', 0, 9999);
            
            // Парсимо записи
            const records = rawItems
              .map((raw: any) => {
                try {
                  let parsed: any;
                  if (typeof raw === 'string') {
                    parsed = JSON.parse(raw);
                  } else {
                    parsed = raw;
                  }
                  
                  if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
                    try {
                      parsed = JSON.parse(parsed.value);
                    } catch {
                      return null;
                    }
                  }
                  
                  return parsed;
                } catch {
                  return null;
                }
              })
              .filter((r: any) => r && r.clientId === existingClientAfterSave.altegioClientId && r.datetime && r.data && Array.isArray(r.data.services));

            // Знаходимо найновіші дати та стан
            let latestPaidServiceDate: string | null = null;
            let latestConsultationDate: string | null = null;
            let latestConsultationAttendance: number | undefined = undefined;
            let latestState: string | null = null;
            let latestStateDatetime: string | null = null;

            for (const record of records) {
              const services = record.data.services || [];
              const datetime = record.datetime;
              const attendance = record.attendance || record.visit_attendance;
              
              if (!datetime) continue;

              const recordDate = new Date(datetime);
              
              // Визначаємо стан
              const determinedState = determineStateFromServices(services);
              if (determinedState && (!latestStateDatetime || new Date(latestStateDatetime) < recordDate)) {
                latestState = determinedState;
                latestStateDatetime = datetime;
              }

              // Перевіряємо консультації
              const hasConsultation = services.some((s: any) => {
                const title = (s.title || s.name || '').toLowerCase();
                return /консультаці/i.test(title);
              });
              
              if (hasConsultation) {
                if (!latestConsultationDate || new Date(latestConsultationDate) < recordDate) {
                  latestConsultationDate = datetime;
                  latestConsultationAttendance = attendance;
                }
                continue;
              }
              
              // Перевіряємо платні послуги
              const hasPaidService = services.some((s: any) => {
                const title = (s.title || s.name || '').toLowerCase();
                if (/консультаці/i.test(title)) return false;
                return true;
              });
              
              if (hasPaidService) {
                if (!latestPaidServiceDate || new Date(latestPaidServiceDate) < recordDate) {
                  latestPaidServiceDate = datetime;
                }
              }
            }

            // Оновлюємо клієнта, якщо знайшли дані
            const updatedClient = await prisma.directClient.findUnique({
              where: { id: existingClientAfterSave.id },
            });
            
            if (updatedClient) {
              const updates: any = {};
              let needsUpdate = false;

              // Оновлюємо consultationBookingDate
              if (latestConsultationDate && (!updatedClient.consultationBookingDate || new Date(updatedClient.consultationBookingDate) < new Date(latestConsultationDate))) {
                updates.consultationBookingDate = latestConsultationDate;
                if (latestConsultationAttendance === 1) {
                  updates.consultationAttended = true;
                } else if (latestConsultationAttendance === -1) {
                  updates.consultationAttended = false;
                }
                needsUpdate = true;
              }

              // Оновлюємо paidServiceDate (тільки якщо немає консультації або консультація вже пройшла)
              if (latestPaidServiceDate) {
                const shouldSetPaidService = !latestConsultationDate || 
                  (updatedClient.consultationBookingDate && new Date(updatedClient.consultationBookingDate) < new Date(latestPaidServiceDate));
                
                if (shouldSetPaidService && (!updatedClient.paidServiceDate || new Date(updatedClient.paidServiceDate) < new Date(latestPaidServiceDate))) {
                  updates.paidServiceDate = latestPaidServiceDate;
                  updates.signedUpForPaidService = true;
                  needsUpdate = true;
                }
              }

              // Оновлюємо стан
              if (latestState && (updatedClient.state === 'client' || updatedClient.state === 'lead' || !updatedClient.state)) {
                let finalState = latestState;
                
                // Якщо є консультація і клієнт не прийшов - встановлюємо consultation-booked
                if (latestConsultationDate && latestConsultationAttendance !== 1) {
                  finalState = 'consultation-booked';
                }
                // Якщо є консультація і клієнт прийшов - встановлюємо consultation
                else if (latestConsultationDate && latestConsultationAttendance === 1) {
                  finalState = 'consultation';
                }
                
                if (finalState !== updatedClient.state) {
                  updates.state = finalState;
                  needsUpdate = true;
                }
              }

              if (needsUpdate) {
                updates.updatedAt = new Date();
                
                // Оновлюємо через Prisma напряму, щоб уникнути рекурсії
                await prisma.directClient.update({
                  where: { id: existingClientAfterSave.id },
                  data: updates,
                });
                
                const changes = [];
                if (updates.paidServiceDate) changes.push(`paidServiceDate: ${updates.paidServiceDate}`);
                if (updates.consultationBookingDate) changes.push(`consultationBookingDate: ${updates.consultationBookingDate}`);
                if (updates.state) changes.push(`state: ${updatedClient.state} -> ${updates.state}`);
                console.log(`[direct-store] ✅ Auto-synced from old webhooks for client ${existingClientAfterSave.id}: ${changes.join(', ')}`);
              }
            }
          } catch (err) {
            console.error(`[direct-store] ⚠️ Failed to auto-sync from old webhooks for client ${existingClientAfterSave.id}:`, err);
          }
        });
      }
    }

    // Логуємо зміну стану, якщо вона відбулася (і finalState заданий).
    // Важливо: якщо finalState = undefined/null, не логуємо (інакше отримуємо спам "Не встановлено").
    if (!skipLogging && finalState && finalState !== previousState) {
      // Додаємо masterId до метаданих для історії
      const logMetadata = {
        ...metadata,
        masterId: client.masterId,
      };
      
      await logStateChange(
        clientIdForLog,
        finalState,
        previousState,
        reason || 'saveDirectClient',
        logMetadata
      );
    }
  } catch (err) {
    console.error(`[direct-store] Failed to save client ${client.id}:`, err);
    throw err;
  }
}

/**
 * Видалити клієнта
 */
export async function deleteDirectClient(id: string): Promise<void> {
  try {
    await prisma.directClient.delete({
      where: { id },
    });
    console.log(`[direct-store] ✅ Deleted client ${id} from Postgres`);
  } catch (err) {
    console.error(`[direct-store] Failed to delete client ${id}:`, err);
    throw err;
  }
}

/**
 * Отримати всі статуси
 */
export async function getAllDirectStatuses(): Promise<DirectStatus[]> {
  try {
    const statuses = await prisma.directStatus.findMany({
      orderBy: { order: 'asc' },
    });
    
    // Якщо статусів немає, ініціалізуємо початкові
    if (statuses.length === 0) {
      await initializeDefaultStatuses();
      const statusesAfterInit = await prisma.directStatus.findMany({
        orderBy: { order: 'asc' },
      });
      return statusesAfterInit.map(prismaStatusToDirectStatus);
    }
    
    return statuses.map(prismaStatusToDirectStatus);
  } catch (err) {
    console.error('[direct-store] Failed to get all statuses:', err);
    return [];
  }
}

/**
 * Отримати статус за ID
 */
export async function getDirectStatus(id: string): Promise<DirectStatus | null> {
  try {
    const status = await prisma.directStatus.findUnique({
      where: { id },
    });
    return status ? prismaStatusToDirectStatus(status) : null;
  } catch (err) {
    console.error(`[direct-store] Failed to get status ${id}:`, err);
    return null;
  }
}

/**
 * Зберегти статус
 */
export async function saveDirectStatus(status: DirectStatus): Promise<void> {
  try {
    const data = directStatusToPrisma(status);
    
    await prisma.directStatus.upsert({
      where: { id: status.id },
      create: {
        ...data,
        createdAt: status.createdAt ? new Date(status.createdAt) : new Date(),
      },
      update: data,
    });
    
    console.log(`[direct-store] ✅ Saved status ${status.id} to Postgres`);
  } catch (err) {
    console.error(`[direct-store] Failed to save status ${status.id}:`, err);
    throw err;
  }
}

/**
 * Видалити статус
 */
export async function deleteDirectStatus(id: string): Promise<void> {
  try {
    await prisma.directStatus.delete({
      where: { id },
    });
    console.log(`[direct-store] ✅ Deleted status ${id} from Postgres`);
  } catch (err) {
    console.error(`[direct-store] Failed to delete status ${id}:`, err);
    throw err;
  }
}

/**
 * Ініціалізувати початкові статуси
 */
export async function initializeDefaultStatuses(): Promise<void> {
  const defaultStatuses: Omit<DirectStatus, 'createdAt'>[] = [
    { id: 'new', name: 'Новий', color: '#3b82f6', order: 1, isDefault: true },
    { id: 'consultation', name: 'Консультація', color: '#fbbf24', order: 2, isDefault: false },
    { id: 'visited', name: 'Прийшов в салон', color: '#10b981', order: 3, isDefault: false },
    { id: 'paid-service', name: 'Записався на послугу', color: '#059669', order: 4, isDefault: false },
    { id: 'cancelled', name: 'Відмінив', color: '#ef4444', order: 5, isDefault: false },
    { id: 'rescheduled', name: 'Перенесено', color: '#f97316', order: 6, isDefault: false },
    { id: 'no-response', name: 'Не відповідає', color: '#6b7280', order: 7, isDefault: false },
  ];

  try {
    // Перевіряємо, які статуси вже є
    const existingStatuses = await prisma.directStatus.findMany({
      select: { id: true },
    });
    const existingIds = new Set(existingStatuses.map(s => s.id));
    
    // Створюємо тільки ті статуси, яких немає
    for (const status of defaultStatuses) {
      if (!existingIds.has(status.id)) {
        const fullStatus: DirectStatus = {
          ...status,
          createdAt: new Date().toISOString(),
        };
        await saveDirectStatus(fullStatus);
      }
    }
    
    console.log('[direct-store] ✅ Initialized default statuses in Postgres');
  } catch (err) {
    console.error('[direct-store] Failed to initialize default statuses:', err);
    throw err;
  }
}
