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
    source: (dbClient.source as 'instagram' | 'tiktok' | 'other') || 'instagram',
    state: (dbClient.state as 'lead' | 'client' | 'consultation' | 'hair-extension' | 'other-services' | 'all-good' | 'too-expensive' | 'no-instagram') || undefined,
    firstContactDate: dbClient.firstContactDate.toISOString(),
    statusId: dbClient.statusId,
    masterId: dbClient.masterId || undefined,
    masterManuallySet: dbClient.masterManuallySet ?? false, // Використовуємо ?? для безпечної обробки null/undefined
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
  };
}

// Конвертація з DirectClient в Prisma модель
function directClientToPrisma(client: DirectClient) {
  return {
    id: client.id,
    instagramUsername: client.instagramUsername.toLowerCase().trim(),
    firstName: client.firstName || null,
    lastName: client.lastName || null,
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
    signupAdmin: client.signupAdmin || null,
    comment: client.comment || null,
    altegioClientId: client.altegioClientId || null,
    lastMessageAt: client.lastMessageAt ? new Date(client.lastMessageAt) : null,
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
    const existingByInstagram = await prisma.directClient.findUnique({
      where: { instagramUsername: normalized },
    });

    // Завжди оновлюємо стан з 'no-instagram' на 'client', якщо клієнт був в стані 'no-instagram'
    const previousState = existingClient.state;
    const updateData: any = {
      instagramUsername: normalized,
      updatedAt: new Date(),
    };
    
    // Якщо клієнт був в стані 'no-instagram', оновлюємо на 'client'
    if (existingClient.state === 'no-instagram') {
      updateData.state = 'client';
      console.log(`[direct-store] Updating state from 'no-instagram' to 'client' for client ${existingClient.id}`);
    }
    
    if (existingByInstagram && existingByInstagram.id !== existingClient.id) {
      // Якщо існує інший клієнт з таким Instagram, об'єднуємо їх:
      // Оновлюємо Altegio ID в існуючому клієнті з правильним Instagram (якщо його немає)
      // Видаляємо поточного клієнта з неправильним Instagram
      console.log(`[direct-store] ⚠️ Instagram ${normalized} already exists for client ${existingByInstagram.id}, merging clients...`);
      
      // Оновлюємо існуючого клієнта з правильним Instagram (додаємо Altegio ID, якщо його немає)
      const mergeUpdateData: any = {
        updatedAt: new Date(),
      };
      
      if (!existingByInstagram.altegioClientId && altegioClientId) {
        mergeUpdateData.altegioClientId = altegioClientId;
        console.log(`[direct-store] Adding Altegio ID ${altegioClientId} to existing client ${existingByInstagram.id}`);
      }
      
      // Якщо клієнт з правильним Instagram мав стан 'no-instagram', оновлюємо його
      if (existingByInstagram.state === 'no-instagram') {
        mergeUpdateData.state = 'client';
        console.log(`[direct-store] Updating state from 'no-instagram' to 'client' for merged client ${existingByInstagram.id}`);
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
      
      // Логуємо зміну стану, якщо вона відбулася
      if (existingByInstagram.state === 'no-instagram' && updated.state === 'client') {
        await logStateChange(
          existingByInstagram.id,
          'client',
          'no-instagram',
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
      const updated = await prisma.directClient.update({
        where: { id: existingClient.id },
        data: updateData,
      });
      
      // Логуємо зміну стану, якщо вона відбулася
      if (previousState === 'no-instagram' && updated.state === 'client') {
        await logStateChange(
          existingClient.id,
          'client',
          'no-instagram',
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
    }
  } catch (err) {
    console.error(`[direct-store] Failed to update Instagram for Altegio client ${altegioClientId}:`, err);
    return null;
  }
}

/**
 * Зберегти клієнта
 */
export async function saveDirectClient(
  client: DirectClient,
  reason?: string,
  metadata?: Record<string, any>,
  skipLogging?: boolean
): Promise<void> {
  try {
    const data = directClientToPrisma(client);
    const normalizedUsername = data.instagramUsername;
    
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
          ...data,
          id: existingByUsername.id, // Зберігаємо існуючий ID
          createdAt: existingByUsername.createdAt < data.firstContactDate 
            ? existingByUsername.createdAt 
            : new Date(data.firstContactDate),
          updatedAt: new Date(),
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
            ...data,
            updatedAt: new Date(),
          },
        });
        console.log(`[direct-store] ✅ Updated client ${client.id} to Postgres`);
      } else {
        // Створюємо новий запис (для нового клієнта previousState = null)
        await prisma.directClient.create({
          data,
        });
        console.log(`[direct-store] ✅ Created client ${client.id} to Postgres`);
      }
    }
    
    // Логуємо зміну стану, якщо вона відбулася (якщо не пропущено логування)
    if (!skipLogging && client.state !== previousState) {
      // Додаємо masterId до метаданих для історії
      const logMetadata = {
        ...metadata,
        masterId: client.masterId,
      };
      
      await logStateChange(
        clientIdForLog,
        client.state,
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
