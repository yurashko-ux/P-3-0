// web/lib/direct-masters/store.ts
// Функції для роботи з відповідальними (майстрами) в Prisma Postgres

import { prisma } from '../prisma';

export type DirectMaster = {
  id: string;
  name: string;
  telegramUsername?: string;
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
 * Отримує відповідальних для вибору (майстри + дірект-менеджери, без тестових та адміністраторів)
 */
export async function getDirectMastersForSelection(): Promise<DirectMaster[]> {
  try {
    const dbMasters = await prisma.directMaster.findMany({
      where: {
        isActive: true,
        role: {
          in: ['master', 'direct-manager'],
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
