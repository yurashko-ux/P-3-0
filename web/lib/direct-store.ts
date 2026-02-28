// web/lib/direct-store.ts
// Функції для роботи з Direct клієнтами та статусами в Prisma Postgres

import { prisma } from './prisma';
import type { DirectClient, DirectStatus } from './direct-types';
import { normalizeInstagram } from './normalize';
import { logStateChange } from './direct-state-log';
import { fetchAltegioClientMetrics } from './altegio/metrics';

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
    lastVisitAt: dbClient.lastVisitAt?.toISOString?.() || undefined,
    lastActivityAt: dbClient.lastActivityAt?.toISOString?.() || undefined,
    lastActivityKeys: Array.isArray(dbClient.lastActivityKeys) ? dbClient.lastActivityKeys : undefined,
    source: (dbClient.source as 'instagram' | 'tiktok' | 'other') || 'instagram',
    state: (dbClient.state as 'client' | 'consultation' | 'consultation-booked' | 'consultation-no-show' | 'consultation-rescheduled' | 'hair-extension' | 'other-services' | 'all-good' | 'too-expensive' | 'message') || undefined,
    firstContactDate: dbClient.firstContactDate.toISOString(),
    statusId: dbClient.statusId,
    masterId: dbClient.masterId || undefined,
    masterManuallySet: dbClient.masterManuallySet ?? false, // Використовуємо ?? для безпечної обробки null/undefined
    consultationDate: dbClient.consultationDate?.toISOString() || undefined,
    visitedSalon: dbClient.visitedSalon || false,
    visitDate: dbClient.visitDate?.toISOString() || undefined,
    signedUpForPaidService: dbClient.signedUpForPaidService || false,
    paidServiceDate: dbClient.paidServiceDate?.toISOString() || undefined,
    paidServiceRecordCreatedAt: dbClient.paidServiceRecordCreatedAt?.toISOString() || undefined,
    paidServiceAttended: dbClient.paidServiceAttended ?? null,
    paidServiceCancelled: dbClient.paidServiceCancelled ?? false,
    paidServiceTotalCost: dbClient.paidServiceTotalCost ?? undefined,
    paidServiceVisitId: dbClient.paidServiceVisitId ?? undefined,
    paidServiceRecordId: dbClient.paidServiceRecordId ?? undefined,
    paidServiceVisitBreakdown: Array.isArray(dbClient.paidServiceVisitBreakdown)
      ? (dbClient.paidServiceVisitBreakdown as { masterName: string; sumUAH: number }[])
      : typeof dbClient.paidServiceVisitBreakdown === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(dbClient.paidServiceVisitBreakdown);
              return Array.isArray(parsed) ? parsed : undefined;
            } catch {
              return undefined;
            }
          })()
        : undefined,
    paidRecordsInHistoryCount: dbClient.paidRecordsInHistoryCount ?? undefined,
    paidServiceIsRebooking: dbClient.paidServiceIsRebooking ?? undefined,
    signupAdmin: dbClient.signupAdmin || undefined,
    comment: dbClient.comment || undefined,
    altegioClientId: dbClient.altegioClientId || undefined,
    lastMessageAt: dbClient.lastMessageAt?.toISOString() || undefined,
    consultationBookingDate: dbClient.consultationBookingDate?.toISOString() || undefined,
    consultationRecordCreatedAt: dbClient.consultationRecordCreatedAt?.toISOString() || undefined,
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
    chatStatusId: dbClient.chatStatusId || undefined,
    chatStatusSetAt: dbClient.chatStatusSetAt?.toISOString?.() || undefined,
    chatStatusCheckedAt: dbClient.chatStatusCheckedAt?.toISOString?.() || undefined,
    chatStatusAnchorMessageId: dbClient.chatStatusAnchorMessageId || undefined,
    chatStatusAnchorMessageReceivedAt: dbClient.chatStatusAnchorMessageReceivedAt?.toISOString?.() || undefined,
    chatStatusAnchorSetAt: dbClient.chatStatusAnchorSetAt?.toISOString?.() || undefined,
    callStatusId: dbClient.callStatusId || undefined,
    callStatusSetAt: dbClient.callStatusSetAt?.toISOString?.() || undefined,
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
    lastVisitAt: client.lastVisitAt ? new Date(client.lastVisitAt) : null,
    lastActivityAt: client.lastActivityAt ? new Date(client.lastActivityAt) : null,
    lastActivityKeys: (client.lastActivityKeys as any) ?? null,
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
    paidServiceRecordCreatedAt: client.paidServiceRecordCreatedAt ? new Date(client.paidServiceRecordCreatedAt) : null,
    paidServiceAttended: client.paidServiceAttended ?? null,
    paidServiceCancelled: client.paidServiceCancelled ?? false,
    paidServiceTotalCost: client.paidServiceTotalCost ?? null,
    paidServiceVisitId: client.paidServiceVisitId ?? null,
    paidServiceRecordId: client.paidServiceRecordId ?? null,
    paidServiceVisitBreakdown: Array.isArray(client.paidServiceVisitBreakdown)
      ? (client.paidServiceVisitBreakdown as any)
      : null,
    paidRecordsInHistoryCount: (client as any).paidRecordsInHistoryCount ?? null,
    paidServiceIsRebooking: (client as any).paidServiceIsRebooking ?? null,
    signupAdmin: client.signupAdmin || null,
    comment: client.comment || null,
    altegioClientId: client.altegioClientId || null,
    lastMessageAt: client.lastMessageAt ? new Date(client.lastMessageAt) : null,
    consultationBookingDate: client.consultationBookingDate ? new Date(client.consultationBookingDate) : null,
    consultationRecordCreatedAt: client.consultationRecordCreatedAt ? new Date(client.consultationRecordCreatedAt) : null,
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
    chatStatusId: client.chatStatusId || null,
    chatStatusSetAt: client.chatStatusSetAt ? new Date(client.chatStatusSetAt) : null,
    chatStatusCheckedAt: client.chatStatusCheckedAt ? new Date(client.chatStatusCheckedAt) : null,
    chatStatusAnchorMessageId: client.chatStatusAnchorMessageId || null,
    chatStatusAnchorMessageReceivedAt: client.chatStatusAnchorMessageReceivedAt
      ? new Date(client.chatStatusAnchorMessageReceivedAt)
      : null,
    chatStatusAnchorSetAt: client.chatStatusAnchorSetAt ? new Date(client.chatStatusAnchorSetAt) : null,
    callStatusId: client.callStatusId || null,
    callStatusSetAt: client.callStatusSetAt ? new Date(client.callStatusSetAt) : null,
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
          spent: dbClient.spent ?? undefined,
          visits: dbClient.visits ?? undefined,
          lastVisitAt: dbClient.lastVisitAt?.toISOString?.() || undefined,
          lastActivityAt: dbClient.lastActivityAt?.toISOString?.() || undefined,
          lastActivityKeys: Array.isArray(dbClient.lastActivityKeys) ? dbClient.lastActivityKeys : undefined,
          source: (dbClient.source as 'instagram' | 'tiktok' | 'other') || 'instagram',
          state: (dbClient.state as 'client' | 'consultation') || undefined,
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
          chatStatusId: dbClient.chatStatusId || undefined,
          chatStatusSetAt: dbClient.chatStatusSetAt?.toISOString?.() || undefined,
          chatStatusCheckedAt: dbClient.chatStatusCheckedAt?.toISOString?.() || undefined,
          chatStatusAnchorMessageId: dbClient.chatStatusAnchorMessageId || undefined,
          chatStatusAnchorMessageReceivedAt: dbClient.chatStatusAnchorMessageReceivedAt?.toISOString?.() || undefined,
          chatStatusAnchorSetAt: dbClient.chatStatusAnchorSetAt?.toISOString?.() || undefined,
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
    console.log(`[direct-store] 🔍 getDirectClientByAltegioId: searching for altegioClientId=${altegioClientId} (type: ${typeof altegioClientId})`);
    const client = await prisma.directClient.findFirst({
      where: { altegioClientId },
    });
    
    if (!client) {
      console.log(`[direct-store] ⚠️ Client not found with altegioClientId=${altegioClientId}, trying alternative search...`);
      // Спробуємо знайти всіх клієнтів з таким altegioClientId (для діагностики)
      const allClients = await prisma.directClient.findMany({
        where: {
          OR: [
            { altegioClientId: altegioClientId },
            { altegioClientId: BigInt(altegioClientId) as any },
          ],
        },
        select: {
          id: true,
          instagramUsername: true,
          altegioClientId: true,
          firstName: true,
          lastName: true,
        },
        take: 5,
      });
      console.log(`[direct-store] 🔍 Alternative search found ${allClients.length} clients:`, allClients.map(c => ({
        id: c.id,
        instagram: c.instagramUsername,
        altegioId: c.altegioClientId,
        altegioIdType: typeof c.altegioClientId,
        name: `${c.firstName} ${c.lastName}`,
      })));
    } else {
      console.log(`[direct-store] ✅ Found client:`, {
        id: client.id,
        instagram: client.instagramUsername,
        altegioId: client.altegioClientId,
        altegioIdType: typeof client.altegioClientId,
      });
    }
    
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

    const syncIdentityFromAltegio = async (directClientId: string) => {
      // Тягнемо phone/visits/spent + імʼя з Altegio після привʼязки IG.
      // ВАЖЛИВО: не рухаємо updatedAt (це адмін-дія), не логуємо PII.
      try {
        const { fetchAltegioClientMetrics } = await import('@/lib/altegio/metrics');
        const { getClient } = await import('@/lib/altegio/clients');
        const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
        const companyId = parseInt(companyIdStr, 10);

        const current = await getDirectClient(directClientId);
        if (!current) return;

        const updates: Partial<DirectClient> = {};

        // phone/visits/spent
        try {
          const m = await fetchAltegioClientMetrics({ altegioClientId });
          if (m.ok) {
            const nextPhone = m.metrics.phone ? String(m.metrics.phone).trim() : '';
            if (nextPhone && (!current.phone || current.phone.trim() !== nextPhone)) {
              updates.phone = nextPhone;
            }
            if (m.metrics.visits !== null && m.metrics.visits !== undefined && current.visits !== m.metrics.visits) {
              updates.visits = m.metrics.visits;
            }
            if (m.metrics.spent !== null && m.metrics.spent !== undefined && current.spent !== m.metrics.spent) {
              updates.spent = m.metrics.spent;
            }
          }
        } catch {}

        // name (як в Altegio): беремо перше слово як firstName, решту як lastName
        try {
          if (companyId && !Number.isNaN(companyId)) {
            const a = await getClient(companyId, altegioClientId);
            const full = (a as any)?.name ? String((a as any).name).trim() : '';
            if (full && !full.includes('{{') && !full.includes('}}')) {
              const parts = full.split(/\s+/).filter(Boolean);
              const firstName = parts[0] || '';
              const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
              if (firstName && (!current.firstName || current.firstName.trim() !== firstName)) {
                updates.firstName = firstName;
              }
              if (lastName && (!current.lastName || current.lastName.trim() !== lastName)) {
                updates.lastName = lastName;
              }
            }
          }
        } catch {}

        const changedKeys = Object.keys(updates);
        if (!changedKeys.length) return;

        const next: DirectClient = {
          ...current,
          ...updates,
          updatedAt: current.updatedAt, // не рухаємо
        };

        await saveDirectClient(
          next,
          'instagram-link-sync-identity',
          { altegioClientId, changedKeys },
          { touchUpdatedAt: false, skipAltegioMetricsSync: true }
        );
      } catch {
        // ignore
      }
    };

    // Знаходимо клієнта за altegioClientId
    console.log(`[direct-store] 🔍 updateInstagramForAltegioClient: searching for client with altegioClientId=${altegioClientId} (type: ${typeof altegioClientId})`);
    
    // Спробуємо різні варіанти пошуку для діагностики
    let existingClient = await prisma.directClient.findFirst({
      where: { altegioClientId },
    });
    
    // Якщо не знайдено, спробуємо пошук з явним приведенням типів
    if (!existingClient) {
      console.log(`[direct-store] ⚠️ Client not found with direct search, trying with explicit type conversion...`);
      // Спробуємо знайти всіх клієнтів з таким altegioClientId (для діагностики)
      const allClientsWithId = await prisma.directClient.findMany({
        where: {
          OR: [
            { altegioClientId: altegioClientId },
            { altegioClientId: BigInt(altegioClientId) as any },
            { altegioClientId: String(altegioClientId) as any },
          ],
        },
        select: {
          id: true,
          instagramUsername: true,
          altegioClientId: true,
          firstName: true,
          lastName: true,
        },
        take: 5,
      });
      console.log(`[direct-store] 🔍 Found ${allClientsWithId.length} clients with alternative searches:`, allClientsWithId.map(c => ({
        id: c.id,
        instagram: c.instagramUsername,
        altegioId: c.altegioClientId,
        altegioIdType: typeof c.altegioClientId,
        name: `${c.firstName} ${c.lastName}`,
      })));
      
      // Спробуємо знайти клієнта "Роса Ганна" для діагностики
      const rosaClient = await prisma.directClient.findFirst({
        where: {
          OR: [
            { firstName: { contains: 'Роса', mode: 'insensitive' } },
            { lastName: { contains: 'Ганна', mode: 'insensitive' } },
            { firstName: { contains: 'Rosa', mode: 'insensitive' } },
            { lastName: { contains: 'Hanna', mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          instagramUsername: true,
          altegioClientId: true,
          firstName: true,
          lastName: true,
        },
      });
      if (rosaClient) {
        console.log(`[direct-store] 🔍 Found "Роса Ганна" client:`, {
          id: rosaClient.id,
          instagram: rosaClient.instagramUsername,
          altegioId: rosaClient.altegioClientId,
          altegioIdType: typeof rosaClient.altegioClientId,
          expectedAltegioId: altegioClientId,
          match: rosaClient.altegioClientId === altegioClientId,
        });
      }
    }

    if (!existingClient) {
      console.log(`[direct-store] ⚠️ Client with Altegio ID ${altegioClientId} not found, trying alternative search...`);
      // Спробуємо знайти клієнта за іншими полями (ім'я, телефон) та встановити altegioClientId
      try {
        const { getClient } = await import('@/lib/altegio/clients');
        const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
        const companyId = parseInt(companyIdStr, 10);
        if (companyId && !Number.isNaN(companyId)) {
          const altegioClient = await getClient(companyId, altegioClientId);
          if (altegioClient) {
            const name = (altegioClient as any)?.name || '';
            const phone = (altegioClient as any)?.phone || '';
            // Шукаємо клієнта за ім'ям або телефоном
            const byName = await prisma.directClient.findFirst({
              where: {
                OR: [
                  { firstName: { contains: name.split(' ')[0] || '', mode: 'insensitive' } },
                  { lastName: { contains: name.split(' ').slice(1).join(' ') || '', mode: 'insensitive' } },
                ],
              },
            });
            const byPhone = phone ? await prisma.directClient.findFirst({
              where: { phone: { contains: phone } },
            }) : null;
            
            // Якщо знайдено клієнта за ім'ям або телефоном, встановлюємо altegioClientId
            const foundClient = byPhone || byName;
            if (foundClient && !foundClient.altegioClientId) {
              console.log(`[direct-store] ✅ Found client ${foundClient.id} by name/phone, setting altegioClientId ${altegioClientId}`);
              await prisma.directClient.update({
                where: { id: foundClient.id },
                data: { altegioClientId },
              });
              // Повторно шукаємо клієнта за altegioClientId
              existingClient = await prisma.directClient.findFirst({
                where: { altegioClientId },
              });
              if (existingClient) {
                console.log(`[direct-store] ✅ Client found after setting altegioClientId: ${existingClient.id}`);
              }
            } else if (foundClient && foundClient.altegioClientId && foundClient.altegioClientId !== altegioClientId) {
              console.log(`[direct-store] ⚠️ Found client ${foundClient.id} but with different altegioClientId: ${foundClient.altegioClientId} vs ${altegioClientId}`);
            }
          }
        }
      } catch (altErr) {
        console.error(`[direct-store] Error in alternative search:`, altErr);
      }
      
      if (!existingClient) {
        console.error(`[direct-store] Client with Altegio ID ${altegioClientId} not found after alternative search`);
        return null;
      }
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
    // ВАЖЛИВО: завжди залишаємо клієнта з Altegio (existingClient), а не з ManyChat (existingByInstagram)
    // Це гарантує, що ім'я, прізвище та телефон будуть з Altegio
    if (existingByInstagram && existingByInstagram.id !== existingClient.id) {
      console.log(`[direct-store] ⚠️ Instagram ${normalized} already exists for client ${existingByInstagram.id}, merging clients...`);
      console.log(`[direct-store] 🔄 MERGE STRATEGY: Keeping Altegio client ${existingClient.id}, deleting ManyChat client ${existingByInstagram.id}`);
      
      // Оновлюємо клієнта з Altegio: додаємо Instagram username з ManyChat клієнта
      const mergeUpdateData: any = {
        instagramUsername: normalized, // Переносимо Instagram з ManyChat клієнта
        // не рухаємо updatedAt (це адмін-дія)
      };
      
      // Ім'я та прізвище залишаємо з Altegio (existingClient) - вони вже правильні
      // Телефон також залишаємо з Altegio (existingClient) - він вже правильний
      
      // Оновлюємо стан на 'client', якщо клієнт мав missing_instagram_*
      const hadMissingInstagram = existingClient.instagramUsername?.startsWith('missing_instagram_') || 
                                  existingClient.instagramUsername?.startsWith('no_instagram_');
      if (hadMissingInstagram) {
        mergeUpdateData.state = 'client';
        console.log(`[direct-store] Updating state to 'client' for Altegio client ${existingClient.id} (had missing_instagram_*, now has real Instagram)`);
      }
      
      // Переносимо історію повідомлень та станів з ManyChat клієнта до Altegio клієнта (якщо потрібно)
      // Але залишаємо основні дані (ім'я, телефон) з Altegio
      try {
        const moved = await moveClientHistory(existingByInstagram.id, existingClient.id);
        if (moved.movedMessages > 0 || moved.movedStateLogs > 0) {
          console.log(`[direct-store] ✅ Перенесено історію з ${existingByInstagram.id} → ${existingClient.id}: messages=${moved.movedMessages}, stateLogs=${moved.movedStateLogs}`);
        }
      } catch (historyErr) {
        console.warn('[direct-store] ⚠️ Не вдалося перенести історію повідомлень/станів (не критично):', historyErr);
      }
      
      // Переносимо аватарку з ManyChat клієнта до Altegio клієнта (якщо вона є)
      try {
        const { kvRead, kvWrite } = await import('@/lib/kv');
        const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;
        const oldUsername = existingByInstagram.instagramUsername;
        const newUsername = normalized;
        
        if (oldUsername && oldUsername !== newUsername && 
            !oldUsername.startsWith('missing_instagram_') && 
            !oldUsername.startsWith('no_instagram_')) {
          const oldKey = directAvatarKey(oldUsername);
          const newKey = directAvatarKey(newUsername);
          
          try {
            const oldAvatar = await kvRead.getRaw(oldKey);
            if (oldAvatar && typeof oldAvatar === 'string' && /^https?:\/\//i.test(oldAvatar.trim())) {
              // Перевіряємо, чи вже є аватарка для нового username
              const existingNewAvatar = await kvRead.getRaw(newKey);
              if (!existingNewAvatar || typeof existingNewAvatar !== 'string' || !/^https?:\/\//i.test(existingNewAvatar.trim())) {
                // Копіюємо аватарку на новий ключ
                await kvWrite.setRaw(newKey, oldAvatar);
                console.log(`[direct-store] ✅ Перенесено аватарку з "${oldUsername}" → "${newUsername}"`);
              } else {
                console.log(`[direct-store] ℹ️ Аватарка для "${newUsername}" вже існує, не перезаписуємо`);
              }
            }
          } catch (avatarErr) {
            console.warn('[direct-store] ⚠️ Не вдалося перенести аватарку (не критично):', avatarErr);
          }
        }
      } catch (avatarErr) {
        console.warn('[direct-store] ⚠️ Помилка при спробі перенести аватарку (не критично):', avatarErr);
      }
      
      // ВАЖЛИВО: Спочатку видаляємо ManyChat клієнта, щоб уникнути конфлікту unique constraint
      // Потім оновлюємо Altegio клієнта з новим Instagram username
      console.log(`[direct-store] Deleting duplicate ManyChat client ${existingByInstagram.id} (keeping Altegio client ${existingClient.id})`);
      await prisma.directClient.delete({
        where: { id: existingByInstagram.id },
      });
      
      // Тепер оновлюємо клієнта з Altegio (після видалення ManyChat клієнта)
      const updated = await prisma.directClient.update({
        where: { id: existingClient.id },
        data: mergeUpdateData,
      });
      
      // Логуємо зміну стану, якщо вона відбулася
      if (hadMissingInstagram && updated.state === 'client') {
        await logStateChange(
          existingClient.id,
          'client',
          existingClient.state || 'lead',
          'instagram-update-merge',
          {
            altegioClientId,
            instagramUsername: normalized,
            source: 'telegram-reply',
            mergedClientId: existingByInstagram.id,
          }
        );
      }
      
      const result = prismaClientToDirectClient(updated);
      console.log(`[direct-store] ✅ Merged clients: kept Altegio client ${existingClient.id}, deleted ManyChat client ${existingByInstagram.id}`);
      console.log(`[direct-store] 📊 Final state: ${result.state}`);
      console.log(`[direct-store] 📊 Final client data: name="${result.firstName} ${result.lastName}", phone="${result.phone || 'not set'}", instagram="${result.instagramUsername}"`);
      await syncIdentityFromAltegio(existingClient.id);
      return result;
    } else {
      // Просто оновлюємо Instagram username (немає конфлікту)
      const updateData: any = {
        instagramUsername: normalized,
        // не рухаємо updatedAt (це адмін-дія)
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
            previousState || 'client',
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
      await syncIdentityFromAltegio(existingClient.id);
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
            console.log(`[direct-store] ⚠️ Found existing client ${existingByInstagramRetry.id} with Instagram "${normalized}", merging (unique constraint fallback)...`);
            console.log(`[direct-store] 🔄 MERGE STRATEGY (fallback): Keeping Altegio client ${existingClient.id}, deleting ManyChat client ${existingByInstagramRetry.id}`);
            
            // Оновлюємо клієнта з Altegio: додаємо Instagram username з ManyChat клієнта
            const mergeUpdateData: any = {
              instagramUsername: normalized, // Переносимо Instagram з ManyChat клієнта
              // не рухаємо updatedAt (це адмін-дія)
            };
            
            // Ім'я та прізвище залишаємо з Altegio (existingClient) - вони вже правильні
            // Телефон також залишаємо з Altegio (existingClient) - він вже правильний
            
            // Оновлюємо стан на 'client', якщо клієнт мав missing_instagram_*
            const hadMissingInstagram = existingClient.instagramUsername?.startsWith('missing_instagram_') || 
                                        existingClient.instagramUsername?.startsWith('no_instagram_');
            if (hadMissingInstagram) {
              mergeUpdateData.state = 'client';
              console.log(`[direct-store] Updating state to 'client' for Altegio client ${existingClient.id} (had missing_instagram_*, now has real Instagram)`);
            }
            
            // Переносимо історію повідомлень та станів з ManyChat клієнта до Altegio клієнта (якщо потрібно)
            try {
              const moved = await moveClientHistory(existingByInstagramRetry.id, existingClient.id);
              if (moved.movedMessages > 0 || moved.movedStateLogs > 0) {
                console.log(`[direct-store] ✅ Перенесено історію з ${existingByInstagramRetry.id} → ${existingClient.id}: messages=${moved.movedMessages}, stateLogs=${moved.movedStateLogs}`);
              }
            } catch (historyErr) {
              console.warn('[direct-store] ⚠️ Не вдалося перенести історію повідомлень/станів (не критично):', historyErr);
            }
            
            // Переносимо аватарку з ManyChat клієнта до Altegio клієнта (якщо вона є)
            try {
              const { kvRead, kvWrite } = await import('@/lib/kv');
              const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;
              const oldUsername = existingByInstagramRetry.instagramUsername;
              const newUsername = normalized;
              
              if (oldUsername && oldUsername !== newUsername && 
                  !oldUsername.startsWith('missing_instagram_') && 
                  !oldUsername.startsWith('no_instagram_')) {
                const oldKey = directAvatarKey(oldUsername);
                const newKey = directAvatarKey(newUsername);
                
                try {
                  const oldAvatar = await kvRead.getRaw(oldKey);
                  if (oldAvatar && typeof oldAvatar === 'string' && /^https?:\/\//i.test(oldAvatar.trim())) {
                    // Перевіряємо, чи вже є аватарка для нового username
                    const existingNewAvatar = await kvRead.getRaw(newKey);
                    if (!existingNewAvatar || typeof existingNewAvatar !== 'string' || !/^https?:\/\//i.test(existingNewAvatar.trim())) {
                      // Копіюємо аватарку на новий ключ
                      await kvWrite.setRaw(newKey, oldAvatar);
                      console.log(`[direct-store] ✅ Перенесено аватарку з "${oldUsername}" → "${newUsername}" (fallback)`);
                    } else {
                      console.log(`[direct-store] ℹ️ Аватарка для "${newUsername}" вже існує, не перезаписуємо (fallback)`);
                    }
                  }
                } catch (avatarErr) {
                  console.warn('[direct-store] ⚠️ Не вдалося перенести аватарку (не критично, fallback):', avatarErr);
                }
              }
            } catch (avatarErr) {
              console.warn('[direct-store] ⚠️ Помилка при спробі перенести аватарку (не критично, fallback):', avatarErr);
            }
            
            // ВАЖЛИВО: Спочатку видаляємо ManyChat клієнта, щоб уникнути конфлікту unique constraint
            // Потім оновлюємо Altegio клієнта з новим Instagram username
            console.log(`[direct-store] Deleting duplicate ManyChat client ${existingByInstagramRetry.id} (keeping Altegio client ${existingClient.id})`);
            await prisma.directClient.delete({
              where: { id: existingByInstagramRetry.id },
            });
            
            // Тепер оновлюємо клієнта з Altegio (після видалення ManyChat клієнта)
            const updated = await prisma.directClient.update({
              where: { id: existingClient.id },
              data: mergeUpdateData,
            });
            
            if (hadMissingInstagram && updated.state === 'client') {
              await logStateChange(
                existingClient.id,
                'client',
                existingClient.state || 'client',
                'instagram-update-merge',
                {
                  altegioClientId,
                  instagramUsername: normalized,
                  source: 'telegram-reply',
                  mergedClientId: existingByInstagramRetry.id,
                }
              );
            }
            
            const result = prismaClientToDirectClient(updated);
            console.log(`[direct-store] ✅ Merged clients after unique constraint error: kept Altegio client ${existingClient.id}, deleted ManyChat client ${existingByInstagramRetry.id}`);
            console.log(`[direct-store] 📊 Final state: ${result.state}`);
            console.log(`[direct-store] 📊 Final client data: name="${result.firstName} ${result.lastName}", phone="${result.phone || 'not set'}", instagram="${result.instagramUsername}"`);
            await syncIdentityFromAltegio(existingClient.id);
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
  skipLoggingOrOptions?: boolean | { skipLogging?: boolean; touchUpdatedAt?: boolean; skipAltegioMetricsSync?: boolean }
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
    const skipAltegioMetricsSync = Boolean((options as any).skipAltegioMetricsSync);

    const computeActivityKeys = (prev: any | null, finalState: string | null | undefined): string[] => {
      const keys: string[] = [];
      const push = (k: string) => {
        if (!keys.includes(k)) keys.push(k);
      };

      const eqDate = (a: Date | null | undefined, b: string | null | undefined) => {
        if (!a && !b) return true;
        const at = a instanceof Date && !isNaN(a.getTime()) ? a.getTime() : NaN;
        const bt = b ? new Date(String(b)).getTime() : NaN;
        if (!Number.isFinite(at) && !Number.isFinite(bt)) return true;
        if (!Number.isFinite(at) || !Number.isFinite(bt)) return false;
        return at === bt;
      };

      const eqScalar = (a: any, b: any) => {
        if (a === null || a === undefined) return b === null || b === undefined;
        if (b === null || b === undefined) return false;
        return a === b;
      };

      // ВАЖЛИВО: дивимось лише на поля, які передали ЯВНО (не undefined),
      // щоб не отримувати хибні тригери від “часткових” save'ів.
      if ((client as any).lastMessageAt !== undefined) {
        if (!eqDate(prev?.lastMessageAt ?? null, (client as any).lastMessageAt ?? null)) push('message');
      }

      if ((client as any).paidServiceDate !== undefined) {
        if (!eqDate(prev?.paidServiceDate ?? null, (client as any).paidServiceDate ?? null)) push('paidServiceDate');
      }
      if ((client as any).paidServiceAttended !== undefined) {
        if (!eqScalar(prev?.paidServiceAttended ?? null, (client as any).paidServiceAttended ?? null)) push('paidServiceAttended');
      }
      if ((client as any).paidServiceCancelled !== undefined) {
        if (!eqScalar(prev?.paidServiceCancelled ?? false, (client as any).paidServiceCancelled ?? false)) push('paidServiceCancelled');
      }
      if ((client as any).paidServiceTotalCost !== undefined) {
        if (!eqScalar(prev?.paidServiceTotalCost ?? null, (client as any).paidServiceTotalCost ?? null)) push('paidServiceTotalCost');
      }

      if ((client as any).consultationBookingDate !== undefined) {
        if (!eqDate(prev?.consultationBookingDate ?? null, (client as any).consultationBookingDate ?? null)) push('consultationBookingDate');
      }
      if ((client as any).consultationAttended !== undefined) {
        if (!eqScalar(prev?.consultationAttended ?? null, (client as any).consultationAttended ?? null)) push('consultationAttended');
      }
      if ((client as any).consultationCancelled !== undefined) {
        if (!eqScalar(prev?.consultationCancelled ?? false, (client as any).consultationCancelled ?? false)) push('consultationCancelled');
      }

      // ВИМКНЕНО: Майстер та state не переміщають клієнта на верх таблиці
      // Ключі майстрів та state прибрано з computeActivityKeys

      return keys;
    };

    // ВАЖЛИВО: метрики з Altegio (phone/visits/spent/lastVisitAt) не можна випадково затирати.
    // Багато шляхів (вебхуки/сервісні синки) передають client без цих полів (undefined),
    // а `directClientToPrisma` перетворює undefined → null і це затирає значення в БД.
    // Тому для UPDATE ми “вирізаємо” ці поля з data, якщо вони не передані явно.
    const applyMetricsPatch = (data: any) => {
      const next = { ...data };
      if (client.phone === undefined) delete next.phone;
      if (client.visits === undefined) delete next.visits;
      if (client.spent === undefined) delete next.spent;
      if ((client as any).lastVisitAt === undefined) delete next.lastVisitAt;
      if (client.lastActivityAt === undefined) delete next.lastActivityAt;
      if (client.lastActivityKeys === undefined) delete next.lastActivityKeys;
      if (client.chatStatusAnchorMessageId === undefined) delete next.chatStatusAnchorMessageId;
      if (client.chatStatusAnchorMessageReceivedAt === undefined) delete next.chatStatusAnchorMessageReceivedAt;
      if (client.chatStatusAnchorSetAt === undefined) delete next.chatStatusAnchorSetAt;
      return next;
    };

    // Перевіряємо, чи serviceMasterName не є адміністратором (автоматичне очищення)
    if (client.serviceMasterName) {
      try {
        const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
        const { isAdminStaffName } = await import('@/lib/altegio/records-grouping');
        const masters = await getAllDirectMasters();
        const masterNameToRole = new Map(
          masters.map((m) => [m.name?.toLowerCase().trim() || '', m.role || 'master'])
        );
        const adminMasters = masters.filter(m => m.role === 'admin' || m.role === 'direct-manager');
        
        const serviceMasterName = (client.serviceMasterName || '').toString().trim();
        const n = serviceMasterName.toLowerCase().trim();
        
        // Перевіряємо, чи це адміністратор
        let isAdmin = false;
        if (isAdminStaffName(n)) {
          isAdmin = true;
        } else {
          const role = masterNameToRole.get(n);
          if (role === 'admin' || role === 'direct-manager') {
            isAdmin = true;
          } else {
            // Часткове співпадіння
            for (const master of adminMasters) {
              const masterName = (master.name || '').toLowerCase().trim();
              if (!masterName) continue;
              const nameFirst = n.split(/\s+/)[0] || '';
              const masterFirst = masterName.split(/\s+/)[0] || '';
              if (nameFirst && masterFirst && nameFirst === masterFirst) {
                isAdmin = true;
                break;
              }
              if (n.includes(masterName) || masterName.includes(n)) {
                isAdmin = true;
                break;
              }
            }
          }
        }
        
        if (isAdmin) {
          console.log(`[direct-store] ⚠️ Blocked setting admin "${serviceMasterName}" as serviceMasterName for client ${client.id}`);
          // Очищаємо serviceMasterName та serviceMasterAltegioStaffId
          client = {
            ...client,
            serviceMasterName: undefined,
            serviceMasterAltegioStaffId: undefined,
          };
        }
      } catch (err) {
        // Якщо не вдалося перевірити - продовжуємо (не блокуємо збереження)
        console.warn(`[direct-store] Failed to check if serviceMasterName is admin:`, err);
      }
    }
    
    const data = directClientToPrisma(client);
    const normalizedUsername = data.instagramUsername;
    
    // ПРАВИЛО: Клієнт не може мати стан "client" більше одного разу (для Altegio клієнтів)
    type DirectClientState = 'client' | 'consultation' | 'consultation-booked' | 'consultation-no-show' | 'consultation-rescheduled' | 'hair-extension' | 'other-services' | 'all-good' | 'too-expensive' | 'message';
    
    // Якщо клієнт намагається встановити 'lead' (старий стан), замінюємо на 'message' (зелена хмарка)
    let finalState: DirectClientState | undefined = client.state;
    if ((client.state as any) === 'lead') {
      finalState = 'message';
      console.log(`[direct-store] ⚠️ Client ${client.id} attempted to set 'lead' state, changed to 'message'`);
    }
    
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
    
    const previousAltegioClientId = existingClientCheck?.altegioClientId || null;
    const hasAltegioId = previousAltegioClientId || data.altegioClientId;
    
    if (finalState === 'client' && hasAltegioId) {
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
    
    // ВАЖЛИВО: Спочатку перевіряємо, чи існує клієнт з таким altegioClientId
    // Це запобігає створенню дублікатів, коли клієнт має інший instagramUsername
    // ПЕРЕВІРКА ЗА altegioClientId МАЄ ПРІОРИТЕТ над перевіркою за instagramUsername
    let existingByAltegioId: any = null;
    if (data.altegioClientId) {
      existingByAltegioId = await prisma.directClient.findFirst({
        where: { altegioClientId: data.altegioClientId },
      });
      if (existingByAltegioId) {
        console.log(`[direct-store] 🔍 Found existing client by altegioClientId ${data.altegioClientId}: ${existingByAltegioId.id} (username: ${existingByAltegioId.instagramUsername})`);
      }
    }
    
    // Спочатку перевіряємо, чи існує клієнт з таким instagramUsername
    const existingByUsername = await prisma.directClient.findUnique({
      where: { instagramUsername: normalizedUsername },
    });
    
    let previousState: string | null | undefined = null;
    let clientIdForLog = client.id;
    
    // ВАЖЛИВО: Перевірка за altegioClientId має пріоритет над перевіркою за instagramUsername
    // Якщо знайдено клієнта за altegioClientId, але він має інший instagramUsername,
    // оновлюємо існуючого клієнта (запобігаємо дублюванню)
    if (existingByAltegioId) {
      previousState = existingByAltegioId.state;
      clientIdForLog = existingByAltegioId.id;
      
      // Якщо instagramUsername вже зайнятий іншим клієнтом (і це не той самий клієнт),
      // не змінюємо instagramUsername, щоб уникнути unique constraint error
      // Або об'єднуємо клієнтів, якщо це різні клієнти
      let targetInstagramUsername = normalizedUsername;
      let needMerge = false;
      let duplicateClientId: string | null = null;
      
      if (existingByUsername && existingByUsername.id !== existingByAltegioId.id) {
        // Знайдено два різні клієнти: один за altegioClientId, інший за instagramUsername
        // Об'єднуємо їх: залишаємо клієнта з altegioClientId, видаляємо іншого
        console.log(`[direct-store] 🔄 Found duplicate: client ${existingByAltegioId.id} (by altegioClientId) and ${existingByUsername.id} (by instagramUsername), merging...`);
        needMerge = true;
        duplicateClientId = existingByUsername.id;
        // Залишаємо instagramUsername з клієнта, який має altegioClientId (або з нового, якщо він кращий)
        // Пріоритет: реальний Instagram > missing_instagram_*
        const existingUsername = existingByAltegioId.instagramUsername;
        const newUsername = normalizedUsername;
        const existingIsMissing = existingUsername?.startsWith('missing_instagram_') || existingUsername?.startsWith('no_instagram_');
        const newIsMissing = newUsername?.startsWith('missing_instagram_') || newUsername?.startsWith('no_instagram_');
        
        if (!existingIsMissing && newIsMissing) {
          // Існуючий має реальний Instagram, новий - missing, залишаємо існуючий
          targetInstagramUsername = existingUsername;
        } else if (existingIsMissing && !newIsMissing) {
          // Існуючий має missing, новий - реальний, використовуємо новий
          targetInstagramUsername = newUsername;
        } else {
          // Обидва однакові типи, використовуємо новий
          targetInstagramUsername = newUsername;
        }
      } else if (existingByUsername && existingByUsername.id === existingByAltegioId.id) {
        // Це той самий клієнт - просто оновлюємо
        targetInstagramUsername = normalizedUsername;
      }
      
      const activityKeys = touchUpdatedAt ? computeActivityKeys(existingByAltegioId, finalState) : null;
      const updateData: any = applyMetricsPatch({
        ...dataWithCorrectState,
        id: existingByAltegioId.id, // Зберігаємо існуючий ID
        instagramUsername: targetInstagramUsername, // Використовуємо визначений username
        createdAt: existingByAltegioId.createdAt < data.firstContactDate 
          ? existingByAltegioId.createdAt 
          : new Date(data.firstContactDate),
        // Новий лід = сьогодні вперше написав. Зберігаємо найранішу firstContactDate при merge.
        firstContactDate: existingByAltegioId.firstContactDate < data.firstContactDate 
          ? existingByAltegioId.firstContactDate 
          : data.firstContactDate,
        ...(touchUpdatedAt ? { updatedAt: new Date() } : {}),
      });
      
      // Гарантуємо збереження altegioClientId
      updateData.altegioClientId = data.altegioClientId || existingByAltegioId.altegioClientId;
      
      if (touchUpdatedAt) {
        updateData.lastActivityAt = new Date();
        updateData.lastActivityKeys = activityKeys;
      }
      
      try {
        await prisma.directClient.update({
          where: { id: existingByAltegioId.id },
          data: updateData,
        });
        
        // Якщо потрібно об'єднати клієнтів, переносимо історію та видаляємо дубль
        if (needMerge && duplicateClientId) {
          try {
            // Переносимо історію повідомлень та станів
            const movedMessages = await prisma.directMessage.updateMany({
              where: { clientId: duplicateClientId },
              data: { clientId: existingByAltegioId.id },
            });
            const movedStateLogs = await prisma.directClientStateLog.updateMany({
              where: { clientId: duplicateClientId },
              data: { clientId: existingByAltegioId.id },
            });
            
            // Видаляємо дубль
            await prisma.directClient.delete({
              where: { id: duplicateClientId },
            });
            
            console.log(`[direct-store] ✅ Merged duplicate client ${duplicateClientId} into ${existingByAltegioId.id} (moved ${movedMessages.count} messages, ${movedStateLogs.count} state logs)`);
          } catch (mergeErr) {
            console.error(`[direct-store] ❌ Failed to merge duplicate client ${duplicateClientId}:`, mergeErr);
            // Продовжуємо, навіть якщо об'єднання не вдалося
          }
        }
        
        console.log(`[direct-store] ✅ Updated existing client ${existingByAltegioId.id} by altegioClientId (prevented duplicate, updated Instagram: ${targetInstagramUsername})`);
      } catch (updateErr: any) {
        // Якщо все ще виникла помилка unique constraint, спробуємо без зміни instagramUsername
        if (updateErr?.code === 'P2002' && updateErr?.meta?.target?.includes('instagramUsername')) {
          console.warn(`[direct-store] ⚠️ Unique constraint error for instagramUsername, keeping existing username: ${existingByAltegioId.instagramUsername}`);
          const fallbackUpdateData: any = {
            ...updateData,
            instagramUsername: existingByAltegioId.instagramUsername, // Залишаємо існуючий username
          };
          await prisma.directClient.update({
            where: { id: existingByAltegioId.id },
            data: fallbackUpdateData,
          });
          console.log(`[direct-store] ✅ Updated existing client ${existingByAltegioId.id} by altegioClientId (kept existing Instagram: ${existingByAltegioId.instagramUsername})`);
        } else {
          throw updateErr;
        }
      }
    } else if (existingByUsername) {
      previousState = existingByUsername.state;
      clientIdForLog = existingByUsername.id;
      
      // Якщо існує клієнт з таким username, оновлюємо його (об'єднуємо дані)
      // Беремо найранішу дату створення та найпізнішу дату оновлення
      const activityKeys = touchUpdatedAt ? computeActivityKeys(existingByUsername, finalState) : null;
      const updateData: any = applyMetricsPatch({
        ...dataWithCorrectState,
        id: existingByUsername.id, // Зберігаємо існуючий ID
        createdAt: existingByUsername.createdAt < data.firstContactDate 
          ? existingByUsername.createdAt 
          : new Date(data.firstContactDate),
        // Новий лід = сьогодні вперше написав. Зберігаємо найранішу firstContactDate при merge.
        firstContactDate: existingByUsername.firstContactDate < data.firstContactDate 
          ? existingByUsername.firstContactDate 
          : data.firstContactDate,
        ...(touchUpdatedAt ? { updatedAt: new Date() } : {}),
      });
      
      // ВАЖЛИВО: гарантуємо збереження altegioClientId при об'єднанні
      // Якщо новий клієнт має altegioClientId, а існуючий не має - встановлюємо його
      // Якщо обидва мають різні - використовуємо той, що в новому клієнті (з Altegio)
      // Якщо існуючий має altegioClientId, а новий не має - зберігаємо існуючий
      console.log(`[direct-store] 🔍 Merge altegioClientId check:`, {
        existingId: existingByUsername.id,
        existingAltegioId: existingByUsername.altegioClientId,
        newAltegioId: data.altegioClientId,
        updateDataAltegioId: updateData.altegioClientId,
      });
      
      if (data.altegioClientId) {
        // Якщо новий клієнт має altegioClientId
        if (!existingByUsername.altegioClientId) {
          // Існуючий не має - встановлюємо з нового
          updateData.altegioClientId = data.altegioClientId;
          console.log(`[direct-store] ✅ Setting altegioClientId ${data.altegioClientId} for merged client ${existingByUsername.id}`);
        } else if (data.altegioClientId !== existingByUsername.altegioClientId) {
          // Обидва мають різні - використовуємо той, що в новому клієнті (з Altegio)
          updateData.altegioClientId = data.altegioClientId;
          console.log(`[direct-store] ⚠️ Replacing altegioClientId ${existingByUsername.altegioClientId} with ${data.altegioClientId} for merged client ${existingByUsername.id}`);
        } else {
          // Обидва мають однаковий - залишаємо як є
          updateData.altegioClientId = data.altegioClientId;
          console.log(`[direct-store] ℹ️ Keeping existing altegioClientId ${data.altegioClientId} for merged client ${existingByUsername.id}`);
        }
      } else if (existingByUsername.altegioClientId) {
        // Новий не має, але існуючий має - зберігаємо існуючий
        updateData.altegioClientId = existingByUsername.altegioClientId;
        console.log(`[direct-store] ℹ️ Preserving existing altegioClientId ${existingByUsername.altegioClientId} for merged client ${existingByUsername.id}`);
      }
      
      // Детальне логування для діагностики
      console.log(`[direct-store] 🔍 Merge details:`, {
        existingId: existingByUsername.id,
        existingAltegioId: existingByUsername.altegioClientId,
        newAltegioId: data.altegioClientId,
        willSetAltegioId: data.altegioClientId && !existingByUsername.altegioClientId,
        finalAltegioId: updateData.altegioClientId,
      });
      
      if (touchUpdatedAt) {
        updateData.lastActivityAt = new Date();
        updateData.lastActivityKeys = activityKeys;
      }
      await prisma.directClient.update({
        where: { instagramUsername: normalizedUsername },
        data: updateData,
      });
      // Перевіряємо, чи правильно зберігся altegioClientId після оновлення
      const afterUpdate = await prisma.directClient.findUnique({
        where: { id: existingByUsername.id },
      });
      if (afterUpdate?.altegioClientId !== updateData.altegioClientId) {
        console.warn(`[direct-store] ⚠️ altegioClientId mismatch after merge: expected ${updateData.altegioClientId}, got ${afterUpdate?.altegioClientId}`);
      }
      console.log(`[direct-store] ✅ Updated existing client ${existingByUsername.id} (username: ${normalizedUsername})`);
    } else {
      // Перевіряємо, чи існує клієнт з таким ID
      const existingById = await prisma.directClient.findUnique({
        where: { id: client.id },
      });
      
        if (existingById) {
        previousState = existingById.state;
        
        // Оновлюємо існуючий запис. Зберігаємо найранішу firstContactDate (новий лід = сьогодні вперше написав).
        const activityKeys = touchUpdatedAt ? computeActivityKeys(existingById, finalState) : null;
        const updateData: any = applyMetricsPatch({
          ...dataWithCorrectState,
          firstContactDate: existingById.firstContactDate < data.firstContactDate 
            ? existingById.firstContactDate 
            : data.firstContactDate,
          ...(touchUpdatedAt ? { updatedAt: new Date() } : {}),
        });
        if (touchUpdatedAt) {
          updateData.lastActivityAt = new Date();
          updateData.lastActivityKeys = activityKeys;
        }
        await prisma.directClient.update({
          where: { id: client.id },
          data: updateData,
        });
        console.log(`[direct-store] ✅ Updated client ${client.id} to Postgres`);
      } else {
        // ПЕРЕД створенням нового клієнта - ФІНАЛЬНА ПЕРЕВІРКА за altegioClientId
        // Це запобігає створенню дублікатів, якщо altegioClientId було додано після першої перевірки
        if (data.altegioClientId) {
          const finalCheckByAltegioId = await prisma.directClient.findFirst({
            where: { altegioClientId: data.altegioClientId },
          });
          
          if (finalCheckByAltegioId) {
            console.log(`[direct-store] ⚠️ Found existing client by altegioClientId ${data.altegioClientId} during final check: ${finalCheckByAltegioId.id} (preventing duplicate creation)`);
            // Оновлюємо існуючого клієнта замість створення нового
            previousState = finalCheckByAltegioId.state;
            clientIdForLog = finalCheckByAltegioId.id;
            
            const activityKeys = touchUpdatedAt ? computeActivityKeys(finalCheckByAltegioId, finalState) : null;
            const updateData: any = applyMetricsPatch({
              ...dataWithCorrectState,
              id: finalCheckByAltegioId.id,
              instagramUsername: normalizedUsername,
              createdAt: finalCheckByAltegioId.createdAt < data.firstContactDate 
                ? finalCheckByAltegioId.createdAt 
                : new Date(data.firstContactDate),
              // Новий лід = сьогодні вперше написав. Зберігаємо найранішу firstContactDate.
              firstContactDate: finalCheckByAltegioId.firstContactDate < data.firstContactDate 
                ? finalCheckByAltegioId.firstContactDate 
                : data.firstContactDate,
              ...(touchUpdatedAt ? { updatedAt: new Date() } : {}),
            });
            
            updateData.altegioClientId = data.altegioClientId || finalCheckByAltegioId.altegioClientId;
            
            if (touchUpdatedAt) {
              updateData.lastActivityAt = new Date();
              updateData.lastActivityKeys = activityKeys;
            }
            
            await prisma.directClient.update({
              where: { id: finalCheckByAltegioId.id },
              data: updateData,
            });
            
            console.log(`[direct-store] ✅ Updated existing client ${finalCheckByAltegioId.id} by altegioClientId (prevented duplicate creation)`);
          } else {
            // Створюємо новий запис (для нового клієнта previousState = null)
            const activityKeys = touchUpdatedAt ? computeActivityKeys(null, finalState) : null;
            const createData: any = applyMetricsPatch(dataWithCorrectState);
            if (touchUpdatedAt) {
              createData.lastActivityAt = new Date();
              createData.lastActivityKeys = activityKeys;
            }
            await prisma.directClient.create({
              data: createData,
            });
            console.log(`[direct-store] ✅ Created client ${client.id} to Postgres`);
          }
        } else {
          // Створюємо новий запис (для нового клієнта previousState = null)
          const activityKeys = touchUpdatedAt ? computeActivityKeys(null, finalState) : null;
          const createData: any = applyMetricsPatch(dataWithCorrectState);
          if (touchUpdatedAt) {
            createData.lastActivityAt = new Date();
            createData.lastActivityKeys = activityKeys;
          }
          await prisma.directClient.create({
            data: createData,
          });
          console.log(`[direct-store] ✅ Created client ${client.id} to Postgres`);
        }
      }
    }

    // Якщо клієнт ВПЕРШЕ отримав altegioClientId — одразу підтягнемо phone/visits/spent з Altegio API.
    // Важливо: не блокуємо бізнес-логіку (у разі помилки просто залогуємо), і НЕ рухаємо updatedAt.
    if (!skipAltegioMetricsSync && !previousAltegioClientId && data.altegioClientId) {
      try {
        await syncAltegioClientMetricsOnce({
          directClientId: clientIdForLog,
          altegioClientId: data.altegioClientId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[direct-store] ⚠️ Не вдалося одразу підтягнути метрики з Altegio (продовжуємо):', {
          directClientId: clientIdForLog,
          altegioClientId: data.altegioClientId,
          error: msg,
        });
      }
    }
    
    // Якщо встановлюється altegioClientId, перевіряємо старі вебхуки для синхронізації дат та станів
    if (data.altegioClientId && (!data.paidServiceDate || !data.consultationBookingDate || client.state === 'client')) {
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

              // Оновлюємо consultationBookingDate (attendance з того ж запису)
              if (latestConsultationDate && (!updatedClient.consultationBookingDate || new Date(updatedClient.consultationBookingDate) < new Date(latestConsultationDate))) {
                updates.consultationBookingDate = latestConsultationDate;
                if (latestConsultationAttendance === 1) {
                  updates.consultationAttended = true;
                } else if (latestConsultationAttendance === -1) {
                  updates.consultationAttended = false;
                }
                needsUpdate = true;
              }

              // Оновлюємо paidServiceDate (при зміні дати — скидаємо attendance)
              if (latestPaidServiceDate) {
                const shouldSetPaidService = !latestConsultationDate || 
                  (updatedClient.consultationBookingDate && new Date(updatedClient.consultationBookingDate) < new Date(latestPaidServiceDate));
                
                if (shouldSetPaidService && (!updatedClient.paidServiceDate || new Date(updatedClient.paidServiceDate) < new Date(latestPaidServiceDate))) {
                  const paidServiceDateChanged = !!updatedClient.paidServiceDate && new Date(updatedClient.paidServiceDate).getTime() !== new Date(latestPaidServiceDate).getTime();
                  updates.paidServiceDate = latestPaidServiceDate;
                  updates.signedUpForPaidService = true;
                  if (paidServiceDateChanged) {
                    updates.paidServiceAttended = null;
                    updates.paidServiceCancelled = false;
                  }
                  needsUpdate = true;
                }
              }

              // Оновлюємо стан
              if (latestState && (updatedClient.state === 'client' || !updatedClient.state)) {
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

async function syncAltegioClientMetricsOnce(params: { directClientId: string; altegioClientId: number }) {
  const now = Date.now();
  const lockKey = `direct:altegio-metrics-sync:${params.directClientId}`;

  const { kvRead, kvWrite } = await import('@/lib/kv');

  const lockRaw = await kvRead.getRaw(lockKey);
  let lock: any = null;
  if (lockRaw) {
    try {
      lock = JSON.parse(lockRaw);
    } catch {
      lock = null;
    }
  }

  const inFlightUntil = lock?.inFlightUntil ? Number(lock.inFlightUntil) : 0;
  const syncedAt = lock?.syncedAt ? String(lock.syncedAt) : '';

  if (syncedAt) {
    console.log('[direct-store] ⏭️ Altegio-метрики вже синхронізовані (перший раз), пропускаємо', {
      directClientId: params.directClientId,
      altegioClientId: params.altegioClientId,
      syncedAt,
    });
    return;
  }

  if (inFlightUntil && inFlightUntil > now) {
    console.log('[direct-store] ⏭️ Altegio-метрики вже “в роботі”, пропускаємо', {
      directClientId: params.directClientId,
      altegioClientId: params.altegioClientId,
      inFlightUntil,
    });
    return;
  }

  await kvWrite.setRaw(
    lockKey,
    JSON.stringify({
      inFlightUntil: now + 60_000,
      startedAt: new Date(now).toISOString(),
      altegioClientId: params.altegioClientId,
    })
  );

  try {
    console.log('[direct-store] 🔄 Перший синк метрик з Altegio (phone/visits/spent + lastVisitAt)', {
      directClientId: params.directClientId,
      altegioClientId: params.altegioClientId,
    });

    const res = await fetchAltegioClientMetrics({ altegioClientId: params.altegioClientId });
    if (res.ok === false) {
      const errText = res.error || 'unknown_error';
      throw new Error(errText);
    }

    // Паралельно пробуємо дістати last_visit_date (через getClient() всередині clients.ts).
    // Не ламаємо синк, якщо не вдалось — просто пропускаємо lastVisitAt.
    let nextLastVisitAt: string | null = null;
    try {
      const { getClient } = await import('@/lib/altegio/clients');
      const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
      const companyId = parseInt(companyIdStr, 10);
      if (companyId && !Number.isNaN(companyId)) {
        const altegioClient = await getClient(companyId, params.altegioClientId);
        const raw = (altegioClient as any)?.last_visit_date ?? (altegioClient as any)?.lastVisitDate ?? null;
        const s = raw ? String(raw).trim() : '';
        if (s) {
          const d = new Date(s);
          if (!isNaN(d.getTime())) {
            nextLastVisitAt = d.toISOString();
            console.log('[direct-store] ✅ Отримано lastVisitAt з Altegio API', {
              directClientId: params.directClientId,
              altegioClientId: params.altegioClientId,
              lastVisitAt: nextLastVisitAt,
            });
          } else {
            console.warn('[direct-store] ⚠️ Не вдалося розпарсити last_visit_date (невалідна дата):', {
              directClientId: params.directClientId,
              altegioClientId: params.altegioClientId,
              raw,
              s,
            });
          }
        } else {
          console.log('[direct-store] ℹ️ last_visit_date відсутній в Altegio для клієнта', {
            directClientId: params.directClientId,
            altegioClientId: params.altegioClientId,
          });
        }
      } else {
        console.warn('[direct-store] ⚠️ ALTEGIO_COMPANY_ID не налаштовано або невалідний:', {
          directClientId: params.directClientId,
          altegioClientId: params.altegioClientId,
          companyIdStr,
          companyId,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[direct-store] ⚠️ Не вдалося витягнути last_visit_date (не критично):', {
        directClientId: params.directClientId,
        altegioClientId: params.altegioClientId,
        error: msg,
      });
      nextLastVisitAt = null;
    }

    const current = await getDirectClient(params.directClientId);
    if (!current) {
      throw new Error('Direct client not found after save');
    }

    const nextPhone = res.metrics.phone ? res.metrics.phone : null;
    const nextVisits = res.metrics.visits ?? null;
    const nextSpent = res.metrics.spent ?? null;

    const updates: Partial<DirectClient> = {};
    if (nextPhone && (!current.phone || current.phone.trim() !== nextPhone)) {
      updates.phone = nextPhone;
    }
    if (nextVisits !== null && current.visits !== nextVisits) {
      updates.visits = nextVisits;
    }
    if (nextSpent !== null && current.spent !== nextSpent) {
      updates.spent = nextSpent;
    }
    if (nextLastVisitAt) {
      const cur = (current as any).lastVisitAt ? String((current as any).lastVisitAt) : '';
      const curTs = cur ? new Date(cur).getTime() : NaN;
      const nextTs = new Date(nextLastVisitAt).getTime();
      if (Number.isFinite(nextTs) && (!Number.isFinite(curTs) || curTs !== nextTs)) {
        (updates as any).lastVisitAt = nextLastVisitAt;
      }
    }

    const changedKeys = Object.keys(updates);
    if (changedKeys.length === 0) {
      console.log('[direct-store] ✅ Altegio-метрики: змін немає (але синк вважаємо завершеним)', {
        directClientId: params.directClientId,
        altegioClientId: params.altegioClientId,
      });
      await kvWrite.setRaw(
        lockKey,
        JSON.stringify({
          syncedAt: new Date().toISOString(),
          inFlightUntil: 0,
          altegioClientId: params.altegioClientId,
          result: 'no_changes',
        })
      );
      return;
    }

    const updated: DirectClient = {
      ...current,
      ...updates,
      // НЕ рухаємо updatedAt, щоб таблиця не “пливла” від технічного синку метрик
      updatedAt: current.updatedAt,
    };

    await saveDirectClient(
      updated,
      'altegio-metrics-first-link',
      { altegioClientId: params.altegioClientId, changedKeys },
      { touchUpdatedAt: false, skipAltegioMetricsSync: true }
    );

    console.log('[direct-store] ✅ Altegio-метрики синхронізовано (перший раз)', {
      directClientId: params.directClientId,
      altegioClientId: params.altegioClientId,
      changedKeys,
    });

    await kvWrite.setRaw(
      lockKey,
      JSON.stringify({
        syncedAt: new Date().toISOString(),
        inFlightUntil: 0,
        altegioClientId: params.altegioClientId,
        changedKeys,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await kvWrite.setRaw(
      lockKey,
      JSON.stringify({
        inFlightUntil: 0,
        lastErrorAt: new Date().toISOString(),
        lastError: msg.slice(0, 500),
        altegioClientId: params.altegioClientId,
      })
    );
    throw err;
  }
}

/**
 * Видалити клієнта
 */
/**
 * Переносить історію повідомлень та станів з одного клієнта до іншого
 * Використовується при злитті записів клієнтів
 */
export async function moveClientHistory(fromClientId: string, toClientId: string): Promise<{ movedMessages: number; movedStateLogs: number }> {
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
