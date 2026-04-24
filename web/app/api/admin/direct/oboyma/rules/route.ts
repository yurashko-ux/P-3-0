// web/app/api/admin/direct/oboyma/rules/route.ts
// CRUD правил «Обойма» (KV); реєстр тригерів для конструктора.

import { NextRequest, NextResponse } from 'next/server';
import {
  getOboymaRulesFromKV,
  saveOboymaRulesToKV,
  validateOboymaRulesPayloadWithCatalogs,
  buildOboymaTriggers,
  buildOboymaConditions,
} from '@/lib/direct-oboyma-rules';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';
import { getAllDirectStatuses } from '@/lib/direct-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
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
    const statuses = await getAllDirectStatuses();
    const conditions = buildOboymaConditions(statuses);
    const triggers = buildOboymaTriggers();
    const rules = await getOboymaRulesFromKV();
    const sorted = [...rules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return NextResponse.json({
      ok: true,
      rules: sorted,
      conditions,
      triggers,
    });
  } catch (error) {
    console.error('[admin/direct/oboyma/rules] GET:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }
    const statuses = await getAllDirectStatuses();
    const conditions = buildOboymaConditions(statuses);
    const triggers = buildOboymaTriggers();
    const rulesRaw = (body as { rules?: unknown })?.rules;
    const validated = validateOboymaRulesPayloadWithCatalogs(rulesRaw, conditions, triggers);
    if (validated.ok === false) {
      return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
    }
    await saveOboymaRulesToKV(validated.rules);
    console.log(`[admin/direct/oboyma/rules] Збережено ${validated.rules.length} правил у KV`);
    return NextResponse.json({
      ok: true,
      rules: validated.rules,
      conditions,
      triggers,
    });
  } catch (error) {
    console.error('[admin/direct/oboyma/rules] POST:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
