// web/app/api/admin/direct/debug-master-column/route.ts
// Діагностичний endpoint для перевірки, чому адміністратори відображаються в колонці "Майстер"

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { getAllDirectMasters } from '@/lib/direct-masters/store';
import { isAdminStaffName } from '@/lib/altegio/records-grouping';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  const tokenParam = req.nextUrl.searchParams.get('token');
  if (ADMIN_PASS && tokenParam === ADMIN_PASS) return true;

  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Завантажуємо всіх майстрів
    const masters = await getAllDirectMasters();
    const adminMasters = masters.filter(m => m.role === 'admin' || m.role === 'direct-manager');
    const masterIdToName = new Map(masters.map(m => [m.id, m.name]));
    const masterNameToRole = new Map(
      masters.map((m) => [m.name?.toLowerCase().trim() || '', m.role || 'master'])
    );

    // Допоміжна функція для перевірки адміністраторів (з частковим співпадінням)
    const isAdminByName = (name: string | null | undefined): boolean => {
      if (!name) return false;
      const n = name.toLowerCase().trim();
      if (isAdminStaffName(n)) return true;
      
      const role = masterNameToRole.get(n);
      if (role === 'admin' || role === 'direct-manager') return true;
      
      for (const master of adminMasters) {
        const masterName = (master.name || '').toLowerCase().trim();
        if (!masterName) continue;
        const nameFirst = n.split(/\s+/)[0] || '';
        const masterFirst = masterName.split(/\s+/)[0] || '';
        if (nameFirst && masterFirst && nameFirst === masterFirst) return true;
        if (n.includes(masterName) || masterName.includes(n)) return true;
      }
      return false;
    };

    // Завантажуємо всіх клієнтів
    const allClients = await getAllDirectClients();
    
    const issues: Array<{
      clientId: string;
      instagramUsername?: string;
      altegioClientId?: number;
      serviceMasterName?: string;
      masterId?: string;
      masterNameFromId?: string;
      masterRoleFromId?: string;
      issue: string;
    }> = [];

    for (const client of allClients) {
      const serviceMasterName = (client.serviceMasterName || '').toString().trim();
      const masterId = client.masterId;
      const masterNameFromId = masterId ? masterIdToName.get(masterId) : undefined;
      const masterFromId = masterId ? masters.find(m => m.id === masterId) : undefined;
      const masterRoleFromId = masterFromId?.role;

      // Перевіряємо serviceMasterName
      if (serviceMasterName && isAdminByName(serviceMasterName)) {
        issues.push({
          clientId: client.id,
          instagramUsername: client.instagramUsername,
          altegioClientId: client.altegioClientId,
          serviceMasterName,
          issue: `serviceMasterName = "${serviceMasterName}" (адміністратор)`,
        });
      }

      // Перевіряємо masterId
      if (masterId && masterRoleFromId && (masterRoleFromId === 'admin' || masterRoleFromId === 'direct-manager')) {
        issues.push({
          clientId: client.id,
          instagramUsername: client.instagramUsername,
          altegioClientId: client.altegioClientId,
          masterId,
          masterNameFromId,
          masterRoleFromId,
          issue: `masterId = "${masterId}" (${masterNameFromId}, роль: ${masterRoleFromId})`,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      totalClients: allClients.length,
      adminMasters: adminMasters.map(m => ({ id: m.id, name: m.name, role: m.role })),
      issuesFound: issues.length,
      issues,
      note: 'Знайдено клієнтів з адміністраторами в serviceMasterName або masterId',
    });
  } catch (error) {
    console.error('[debug-master-column] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
