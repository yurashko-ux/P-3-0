// web/lib/direct-callback-reminder-apply.ts
// Спільна логіка оновлення колонки «Передзвонити» (ручне збереження та «Обойма»).

import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import { getTodayKyiv, getKyivDayUtcBounds } from '@/lib/direct-stats-config';
import type { OboymaDeadlineRule } from '@/lib/direct-oboyma-rules';
import { normalizeOboymaComment } from '@/lib/direct-oboyma-rules';
import {
  ensureDirectCallbackReminderColumnsExist,
} from '@/lib/direct-callback-reminder-db-ensure';
import type { CallbackReminderHistoryEntry, DirectClient } from '@/lib/direct-types';
import { getDirectClient, saveDirectClient } from '@/lib/direct-store';

/** Додає N календарних днів до дня Europe/Kyiv (YYYY-MM-DD). */
export function addCalendarDaysKyiv(ymd: string, delta: number): string {
  const trimmed = (ymd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const { startUtc } = getKyivDayUtcBounds(trimmed);
  const ms = startUtc.getTime() + delta * 24 * 60 * 60 * 1000;
  return kyivDayFromISO(new Date(ms).toISOString());
}

/**
 * Чи є у клієнта «майбутній» дедлайн (дата строго після сьогодні, Kyiv) —
 * у такому разі автоматика лише дописує історію (за планом «Обойма»).
 */
export function hasFutureCallbackReminderKyivDay(
  callbackReminderKyivDay: string | null | undefined,
  todayKyiv: string
): boolean {
  const d = (callbackReminderKyivDay ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d > todayKyiv;
}

function normalizeManualNote(raw: string | null): string | null {
  return normalizeOboymaComment(raw);
}

/**
 * Повне оновлення як у POST /callback-reminder: історія + поточні поля колонки.
 */
export async function applyCallbackReminderFullUpdate(
  client: DirectClient,
  scheduledKyivDay: string | null,
  note: string | null,
  saveReason: string,
  metadata?: Record<string, unknown>
): Promise<DirectClient> {
  const entry: CallbackReminderHistoryEntry = {
    createdAt: new Date().toISOString(),
    scheduledKyivDay,
    note,
  };
  const prev = Array.isArray(client.callbackReminderHistory) ? client.callbackReminderHistory : [];
  const nextHistory: CallbackReminderHistoryEntry[] = [...prev, entry];
  const nowIso = new Date().toISOString();
  const mergedActivityKeys = [...new Set([...(client.lastActivityKeys ?? []), 'callbackReminder'])];
  const updated: DirectClient = {
    ...client,
    callbackReminderHistory: nextHistory,
    callbackReminderKyivDay: scheduledKyivDay,
    callbackReminderNote: note,
    lastActivityAt: nowIso,
    lastActivityKeys: mergedActivityKeys,
  };
  await saveDirectClient(updated, saveReason, metadata, { touchUpdatedAt: false });
  return updated;
}

/**
 * Лише допис у історії без зміни callbackReminderKyivDay / callbackReminderNote.
 */
export async function appendCallbackReminderHistoryOnly(
  client: DirectClient,
  scheduledKyivDay: string | null,
  note: string | null,
  saveReason: string,
  metadata?: Record<string, unknown>
): Promise<DirectClient> {
  const entry: CallbackReminderHistoryEntry = {
    createdAt: new Date().toISOString(),
    scheduledKyivDay,
    note,
  };
  const prev = Array.isArray(client.callbackReminderHistory) ? client.callbackReminderHistory : [];
  const nextHistory: CallbackReminderHistoryEntry[] = [...prev, entry];
  const nowIso = new Date().toISOString();
  const mergedActivityKeys = [...new Set([...(client.lastActivityKeys ?? []), 'callbackReminder'])];
  const updated: DirectClient = {
    ...client,
    callbackReminderHistory: nextHistory,
    lastActivityAt: nowIso,
    lastActivityKeys: mergedActivityKeys,
  };
  await saveDirectClient(updated, saveReason, metadata, { touchUpdatedAt: false });
  return updated;
}

export type ApplyOboymaRuleResult = {
  ok: boolean;
  applied: 'full' | 'history_only' | 'skipped';
  reason?: string;
};

/**
 * Застосування правила «Обойма» до клієнта (виклик з майбутніх webhook/cron).
 * eventKyivDay — якір для offsetDays (семантику задає тип тригера).
 */
export async function applyOboymaRuleToClient(args: {
  clientId: string;
  rule: OboymaDeadlineRule;
  eventKyivDay: string;
}): Promise<ApplyOboymaRuleResult> {
  const { clientId, rule, eventKyivDay } = args;
  if (!rule.active) {
    return { ok: true, applied: 'skipped', reason: 'правило вимкнено' };
  }
  const columnsOk = await ensureDirectCallbackReminderColumnsExist();
  if (columnsOk.ok === false) {
    console.error('[oboyma/apply] Колонки «передзвонити» недоступні:', columnsOk.error);
    return { ok: false, applied: 'skipped', reason: 'ddl' };
  }

  const client = await getDirectClient(clientId);
  if (!client) {
    return { ok: false, applied: 'skipped', reason: 'клієнт не знайдений' };
  }

  const today = getTodayKyiv();
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test((eventKyivDay || '').trim()) ? eventKyivDay.trim() : today;
  const totalOffsetDays = (rule.daysAfterCondition ?? 0) + (rule.daysAfterTrigger ?? 0);
  const targetKyivDay = addCalendarDaysKyiv(anchor, totalOffsetDays);
  const note = normalizeManualNote(normalizeOboymaComment(rule.comment));

  const future = hasFutureCallbackReminderKyivDay(client.callbackReminderKyivDay, today);

  if (future) {
    await appendCallbackReminderHistoryOnly(
      client,
      targetKyivDay,
      note,
      'oboyma-rule-history-only',
      { clientId, ruleId: rule.id, triggerKey: rule.triggerKey }
    );
    console.log(
      `[oboyma/apply] Лише історія (майбутній дедлайн): clientId=${clientId} ruleId=${rule.id} target=${targetKyivDay}`
    );
    return { ok: true, applied: 'history_only' };
  }

  await applyCallbackReminderFullUpdate(
    client,
    targetKyivDay,
    note,
    'oboyma-rule',
    { clientId, ruleId: rule.id, triggerKey: rule.triggerKey }
  );
  console.log(`[oboyma/apply] Повне оновлення: clientId=${clientId} ruleId=${rule.id} target=${targetKyivDay}`);
  return { ok: true, applied: 'full' };
}
