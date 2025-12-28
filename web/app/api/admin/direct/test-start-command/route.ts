// web/app/api/admin/direct/test-start-command/route.ts
// Endpoint для тестування обробки /start команди

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getMasterByTelegramUsername, getAllDirectMasters } from '@/lib/direct-masters/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET - перевірити, чи знайдено адміністратора за username
 */
export async function GET(req: NextRequest) {
  try {
    const username = req.nextUrl.searchParams.get('username') || 'kolachnykv';
    
    const results: any = {
      username,
      searchResults: {},
    };
    
    // Шукаємо через getMasterByTelegramUsername
    try {
      const directMaster = await getMasterByTelegramUsername(username);
      results.searchResults.byFunction = directMaster ? {
        id: directMaster.id,
        name: directMaster.name,
        telegramUsername: directMaster.telegramUsername,
        telegramChatId: directMaster.telegramChatId,
        role: directMaster.role,
      } : null;
    } catch (err) {
      results.searchResults.byFunction = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
    
    // Шукаємо через getAllDirectMasters
    try {
      const allMasters = await getAllDirectMasters();
      const masterByUsername = allMasters.find(m => {
        const masterUsername = m.telegramUsername?.toLowerCase().replace(/^@/, '') || '';
        const searchUsername = username.toLowerCase().replace(/^@/, '');
        return masterUsername === searchUsername;
      });
      
      results.searchResults.byArray = masterByUsername ? {
        id: masterByUsername.id,
        name: masterByUsername.name,
        telegramUsername: masterByUsername.telegramUsername,
        telegramChatId: masterByUsername.telegramChatId,
        role: masterByUsername.role,
      } : null;
      
      results.allMasters = allMasters.map(m => ({
        id: m.id,
        name: m.name,
        telegramUsername: m.telegramUsername,
        telegramChatId: m.telegramChatId,
        role: m.role,
      }));
    } catch (err) {
      results.searchResults.byArray = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
    
    // Шукаємо напряму в базі
    try {
      const dbMasters = await prisma.directMaster.findMany({
        where: {
          isActive: true,
        },
      });
      
      const dbMasterByUsername = dbMasters.find(m => {
        const masterUsername = (m.telegramUsername || '').toLowerCase().replace(/^@/, '');
        const searchUsername = username.toLowerCase().replace(/^@/, '');
        return masterUsername === searchUsername;
      });
      
      results.searchResults.byDatabase = dbMasterByUsername ? {
        id: dbMasterByUsername.id,
        name: dbMasterByUsername.name,
        telegramUsername: dbMasterByUsername.telegramUsername,
        telegramChatId: dbMasterByUsername.telegramChatId,
        role: dbMasterByUsername.role,
      } : null;
      
      results.dbMasters = dbMasters.map(m => ({
        id: m.id,
        name: m.name,
        telegramUsername: m.telegramUsername,
        telegramChatId: m.telegramChatId,
        role: m.role,
      }));
    } catch (err) {
      results.searchResults.byDatabase = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
    
    return NextResponse.json({
      ok: true,
      results,
    });
  } catch (err) {
    console.error('[test-start-command] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

