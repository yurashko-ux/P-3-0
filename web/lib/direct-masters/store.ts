// web/lib/direct-masters/store.ts
// Функції для роботи з відповідальними (майстрами) в Prisma Postgres

import { prisma } from '../prisma';

export type DirectMaster = {
  id: string;
  name: string;
  telegramUsername?: string;
  telegramChatId?: number;
  role: 'master' | 'direct-manager' | 'admin';
  altegioStaffId?: number;
  isActive: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
};

// Конвертація з Prisma моделі в DirectMaster
function prismaMasterToDirectMaster(dbMaster: any): DirectMaster {
  try {
    return {
      id: dbMaster.id,
      name: dbMaster.name,
      telegramUsername: dbMaster.telegramUsername || undefined,
      telegramChatId: dbMaster.telegramChatId ?? undefined, // Використовуємо ?? для коректної обробки null
      role: (dbMaster.role as 'master' | 'direct-manager' | 'admin') || 'master',
      altegioStaffId: dbMaster.altegioStaffId ?? undefined,
      isActive: dbMaster.isActive ?? true,
      order: dbMaster.order || 0,
      createdAt: dbMaster.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: dbMaster.updatedAt?.toISOString() || new Date().toISOString(),
    };
  } catch (err) {
    console.error('[direct-masters] Error converting Prisma master to DirectMaster:', err, dbMaster);
    throw err;
  }
}

/**
 * Отримує всіх відповідальних
 */
export async function getAllDirectMasters(): Promise<DirectMaster[]> {
  try {
    const dbMasters = await prisma.directMaster.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    console.log(`[direct-masters] Found ${dbMasters.length} active masters in database`);
    const converted = dbMasters.map(prismaMasterToDirectMaster);
    console.log(`[direct-masters] Successfully converted ${converted.length} masters`);
    return converted;
  } catch (err: any) {
    console.error('[direct-masters] Error getting all masters:', err);
    // Детальне логування помилки
    if (err instanceof Error) {
      console.error('[direct-masters] Error details:', {
        name: err.name,
        message: err.message,
        code: (err as any).code,
        stack: err.stack?.substring(0, 500),
      });
      
      // Перевіряємо, чи це помилка через відсутнє поле (міграція не виконана)
      // P2022 - Column does not exist
      if (
        (err as any).code === 'P2022' ||
        err.message.includes('telegramChatId') || 
        err.message.includes('Unknown column') || 
        (err.message.includes('column') && err.message.includes('does not exist'))
      ) {
        console.error('[direct-masters] ⚠️ Database schema error - telegramChatId field is missing. Please run Prisma migration.');
        console.error('[direct-masters] ⚠️ Migration needed: Add telegramChatId column to direct_masters table');
        return [];
      }
      
      // Якщо це помилка підключення до бази даних - повертаємо порожній масив
      if (
        err.message.includes('Can\'t reach database server') || 
        err.message.includes('database server') ||
        err.name === 'PrismaClientInitializationError' ||
        err.message.includes('P1001') // Prisma connection error code
      ) {
        console.error('[direct-masters] ⚠️ Database connection error - returning empty array');
        return [];
      }
    }
    throw err;
  }
}

/**
 * Отримує відповідального по ID
 */
export async function getDirectMasterById(id: string): Promise<DirectMaster | null> {
  try {
    const dbMaster = await prisma.directMaster.findUnique({
      where: { id },
    });
    return dbMaster ? prismaMasterToDirectMaster(dbMaster) : null;
  } catch (err) {
    console.error(`[direct-masters] Error getting master ${id}:`, err);
    throw err;
  }
}

/**
 * Зберігає відповідального (створює або оновлює)
 */
export async function saveDirectMaster(master: DirectMaster): Promise<DirectMaster> {
  try {
    const dbMaster = await prisma.directMaster.upsert({
      where: { id: master.id },
      update: {
        name: master.name,
        telegramUsername: master.telegramUsername || null,
        telegramChatId: master.telegramChatId || null,
        role: master.role,
        altegioStaffId: master.altegioStaffId || null,
        isActive: master.isActive,
        order: master.order,
        updatedAt: new Date(),
      },
      create: {
        id: master.id,
        name: master.name,
        telegramUsername: master.telegramUsername || null,
        telegramChatId: master.telegramChatId || null,
        role: master.role,
        altegioStaffId: master.altegioStaffId || null,
        isActive: master.isActive,
        order: master.order,
        createdAt: new Date(master.createdAt || new Date().toISOString()),
        updatedAt: new Date(),
      },
    });
    return prismaMasterToDirectMaster(dbMaster);
  } catch (err) {
    console.error(`[direct-masters] Error saving master ${master.id}:`, err);
    throw err;
  }
}

/**
 * Видаляє відповідального (помічає як неактивного)
 */
export async function deleteDirectMaster(id: string): Promise<void> {
  try {
    await prisma.directMaster.update({
      where: { id },
      data: { isActive: false },
    });
  } catch (err) {
    console.error(`[direct-masters] Error deleting master ${id}:`, err);
    throw err;
  }
}

/**
 * Знаходить дірект-менеджера (першого активного)
 */
export async function getDirectManager(): Promise<DirectMaster | null> {
  try {
    const dbMaster = await prisma.directMaster.findFirst({
      where: {
        isActive: true,
        role: 'direct-manager',
      },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    return dbMaster ? prismaMasterToDirectMaster(dbMaster) : null;
  } catch (err) {
    console.error('[direct-masters] Error getting direct manager:', err);
    return null;
  }
}

/**
 * Знаходить майстра за Altegio staff_id
 */
export async function getMasterByAltegioStaffId(staffId: number): Promise<DirectMaster | null> {
  try {
    const dbMaster = await prisma.directMaster.findFirst({
      where: {
        isActive: true,
        altegioStaffId: staffId,
        role: 'master',
      },
    });
    return dbMaster ? prismaMasterToDirectMaster(dbMaster) : null;
  } catch (err) {
    console.error(`[direct-masters] Error getting master by Altegio staff_id ${staffId}:`, err);
    return null;
  }
}

/**
 * Знаходить майстра за Telegram username
 */
export async function getMasterByTelegramUsername(username: string): Promise<DirectMaster | null> {
  try {
    if (!username || !username.trim()) {
      console.log(`[direct-masters] getMasterByTelegramUsername: empty username`);
      return null;
    }

    // Нормалізуємо username (прибираємо @, приводимо до нижнього регістру)
    const normalizedUsername = username.trim().toLowerCase().replace(/^@/, '');
    console.log(`[direct-masters] getMasterByTelegramUsername: searching for username="${normalizedUsername}" (original: "${username}")`);
    
    // Спочатку пробуємо точне співпадіння (case-insensitive)
    let dbMaster = await prisma.directMaster.findFirst({
      where: {
        isActive: true,
        telegramUsername: {
          equals: normalizedUsername,
          mode: 'insensitive',
        },
      },
    });
    
    // Якщо не знайшли, пробуємо знайти всіх активних і порівняти вручну
    if (!dbMaster) {
      console.log(`[direct-masters] getMasterByTelegramUsername: not found with equals, trying manual search`);
      const allMasters = await prisma.directMaster.findMany({
        where: { isActive: true },
      });
      
      dbMaster = allMasters.find(m => {
        const masterUsername = (m.telegramUsername || '').trim().toLowerCase().replace(/^@/, '');
        return masterUsername === normalizedUsername;
      }) || null;
      
      if (dbMaster) {
        console.log(`[direct-masters] getMasterByTelegramUsername: found via manual search: ${dbMaster.name} (${dbMaster.telegramUsername})`);
      } else {
        console.log(`[direct-masters] getMasterByTelegramUsername: not found. Available usernames: ${allMasters.map(m => m.telegramUsername).filter(Boolean).join(', ')}`);
      }
    } else {
      console.log(`[direct-masters] getMasterByTelegramUsername: found via database query: ${dbMaster.name} (${dbMaster.telegramUsername})`);
    }

    return dbMaster ? prismaMasterToDirectMaster(dbMaster) : null;
  } catch (err) {
    console.error(`[direct-masters] Error getting master by Telegram username "${username}":`, err);
    return null;
  }
}

/**
 * Знаходить майстра за ім'ям (staffName)
 */
export async function getMasterByName(staffName: string): Promise<DirectMaster | null> {
  try {
    if (!staffName || !staffName.trim()) {
      return null;
    }

    // Нормалізуємо ім'я (прибираємо зайві пробіли, приводимо до нижнього регістру)
    const normalizedName = staffName.trim().toLowerCase();
    
    // Спочатку пробуємо точне співпадіння
    const dbMaster = await prisma.directMaster.findFirst({
      where: {
        isActive: true,
        name: {
          equals: normalizedName,
          mode: 'insensitive',
        },
      },
    });

    if (dbMaster) {
      return prismaMasterToDirectMaster(dbMaster);
    }

    // Якщо точного співпадіння немає, пробуємо часткове
    const allMasters = await prisma.directMaster.findMany({
      where: {
        isActive: true,
      },
    });

    // Шукаємо майстра, чиє ім'я містить staffName або навпаки
    const matchingMaster = allMasters.find((m) => {
      const masterName = m.name.toLowerCase().trim();
      return masterName === normalizedName || 
             masterName.includes(normalizedName) || 
             normalizedName.includes(masterName);
    });

    return matchingMaster ? prismaMasterToDirectMaster(matchingMaster) : null;
  } catch (err) {
    console.error(`[direct-masters] Error getting master by name "${staffName}":`, err);
    return null;
  }
}

/**
 * Отримує відповідальних для вибору (майстри + дірект-менеджери + адміністратори, без тестових)
 */
export async function getDirectMastersForSelection(): Promise<DirectMaster[]> {
  try {
    const dbMasters = await prisma.directMaster.findMany({
      where: {
        isActive: true,
        role: {
          in: ['master', 'direct-manager', 'admin'],
        },
      },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    
    // Фільтруємо тестових
    return dbMasters
      .filter(m => {
        // Виключаємо тестових
        if (m.id.includes('test') || m.id.includes('tester')) return false;
        if (m.name.toLowerCase().includes('тест') || m.name.toLowerCase().includes('test')) return false;
        return true;
      })
      .map(prismaMasterToDirectMaster);
  } catch (err) {
    console.error('[direct-masters] Error getting masters for selection:', err);
    throw err;
  }
}
