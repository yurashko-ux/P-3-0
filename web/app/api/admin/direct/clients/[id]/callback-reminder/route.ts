// web/app/api/admin/direct/clients/[id]/callback-reminder/route.ts
// Зберегти нагадування «передзвонити»: append історії + поточні поля.

import { NextRequest, NextResponse } from 'next/server';
import {
  getDirectClient,
  getDirectClientByInstagram,
  getAllDirectClients,
  isTransientDirectDbFailure,
} from '@/lib/direct-store';
import {
  CALLBACK_REMINDER_MANUAL_DDL_SQL,
  ensureDirectCallbackReminderColumnsExist,
} from '@/lib/direct-callback-reminder-db-ensure';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';
import { applyCallbackReminderFullUpdate } from '@/lib/direct-callback-reminder-apply';

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

async function resolveParams(params: { id: string } | Promise<{ id: string }>): Promise<{ id: string }> {
  return typeof (params as any)?.then === 'function' ? await (params as Promise<{ id: string }>) : params as { id: string };
}

type Body = { scheduledKyivDay?: unknown; note?: unknown; _fallbackInstagram?: unknown };

function normalizeScheduledKyivDay(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
  return raw.trim();
}

function normalizeNote(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length ? t.slice(0, 2000) : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await resolveParams(params);
    if (!id || typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ ok: false, error: 'Client ID is required' }, { status: 400 });
    }

    const columnsOk = await ensureDirectCallbackReminderColumnsExist();
    if (columnsOk.ok === false) {
      console.error('[direct/callback-reminder] Колонки нагадувань недоступні:', columnsOk.error);
      const ddlDenied =
        columnsOk.pgCode === '42501' ||
        /42501|must be owner|insufficient privilege/i.test(columnsOk.error);
      const userMessage = ddlDenied
        ? 'Роль підключення з Vercel не має прав на ALTER TABLE (PostgreSQL 42501). Відкрийте Neon Console → SQL Editor і виконайте скрипт нижче один раз під роллю власника таблиці / адміністратора проєкту.'
        : 'Не вдалося додати колонки «передзвонити» (DDL). Спробуйте виконати SQL у Neon → SQL Editor (поле manualSql нижче) або накатіть міграції з машини з prisma migrate deploy.';
      return NextResponse.json(
        {
          ok: false,
          error: userMessage,
          detail: columnsOk.error,
          code: columnsOk.code,
          pgCode: columnsOk.pgCode,
          manualSql: CALLBACK_REMINDER_MANUAL_DDL_SQL,
        },
        { status: 503 }
      );
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    if (body.note != null && typeof body.note !== 'string') {
      return NextResponse.json({ ok: false, error: 'Невалідний коментар' }, { status: 400 });
    }

    const scheduledKyivDay = normalizeScheduledKyivDay(body.scheduledKyivDay);
    const note = normalizeNote(body.note);
    if (body.scheduledKyivDay != null && body.scheduledKyivDay !== '' && scheduledKyivDay === null) {
      console.warn('[direct/callback-reminder] Невалідна scheduledKyivDay:', body.scheduledKyivDay);
      return NextResponse.json(
        { ok: false, error: 'Невалідна дата (очікується YYYY-MM-DD або порожньо)' },
        { status: 400 }
      );
    }
    let client = await getDirectClient(id);
    if (!client) {
      const all = await getAllDirectClients();
      client = all.find((c) => c.id === id) || all.find((c) => c.id === id.trim()) || null;
    }
    if (!client && body._fallbackInstagram) {
      client = await getDirectClientByInstagram(String(body._fallbackInstagram));
    }
    if (!client) {
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }

    const updated = await applyCallbackReminderFullUpdate(
      client,
      scheduledKyivDay,
      note,
      'ui-callback-reminder',
      { clientId: client.id }
    );

    const persisted = await getDirectClient(client.id);
    if (!persisted) {
      console.warn(`[direct/callback-reminder] Після збереження getDirectClient null id=${client.id}`);
    }
    return NextResponse.json({ ok: true, client: persisted ?? updated });
  } catch (error) {
    const { id } = await resolveParams(params).catch(() => ({ id: 'unknown' }));
    console.error(`[direct/clients/${id}/callback-reminder] POST error:`, error);
    if (isTransientDirectDbFailure(error)) {
      return NextResponse.json(
        {
          ok: false,
          retryable: true,
          error: 'Тимчасовий збій бази даних. Спробуйте повторити запит.',
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
