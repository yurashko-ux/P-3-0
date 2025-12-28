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
  return {
    id: dbMaster.id,
    name: dbMaster.name,
    telegramUsername: dbMaster.telegramUsername || undefined,
    telegramChatId: dbMaster.telegramChatId || undefined,
    role: (dbMaster.role as 'master' | 'direct-manager' | 'admin') || 'master',
    altegioStaffId: dbMaster.altegioStaffId || undefined,
    isActive: dbMaster.isActive ?? true,
    order: dbMaster.order || 0,
    createdAt: dbMaster.createdAt.toISOString(),
    updatedAt: dbMaster.updatedAt.toISOString(),
  };
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
    return dbMasters.map(prismaMasterToDirectMaster);
  } catch (err) {
    console.error('[direct-masters] Error getting all masters:', err);
    // Якщо це помилка підключення до бази даних - повертаємо порожній масив
    if (err instanceof Error && (
      err.message.includes('Can\'t reach database server') || 
      err.message.includes('database server') ||
      err.name === 'PrismaClientInitializationError'
    )) {
      console.error('[direct-masters] ⚠️ Database connection error - returning empty array');
      return [];
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
