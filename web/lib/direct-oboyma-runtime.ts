// web/lib/direct-oboyma-runtime.ts
// Runtime для «Обойма» у batch-режимі: прогін правил по клієнтах і створення нагадувань.

import type { DirectClient } from '@/lib/direct-types';
import type { OboymaDeadlineRule } from '@/lib/direct-oboyma-rules';
import {
  addCalendarDaysKyiv,
  applyCallbackReminderFullUpdate,
  appendCallbackReminderHistoryOnly,
  hasFutureCallbackReminderKyivDay,
} from '@/lib/direct-callback-reminder-apply';
import { getAllDirectClients } from '@/lib/direct-store';
import { ensureDirectCallbackReminderColumnsExist } from '@/lib/direct-callback-reminder-db-ensure';
import { getTodayKyiv, toKyivDay } from '@/lib/direct-stats-config';
import { kvRead, kvWrite } from '@/lib/kv';

type RuleMatch = {
  ruleId: string;
  triggerKey: string;
  scheduledKyivDay: string;
  comment: string;
};

export type OboymaRuntimeRunStats = {
  clientsChecked: number;
  clientsMatched: number;
  remindersUpdated: number;
  historyOnlyUpdates: number;
  matchesTotal: number;
  byRule: Record<string, { created: number; active: number }>;
};

const OBOYMA_RULE_STATS_KV_KEY = 'direct:oboyma:rule-stats:latest';

function daysDiff(fromDay: string, toDay: string): number {
  const fromIso = `${fromDay}T12:00:00Z`;
  const toIso = `${toDay}T12:00:00Z`;
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.round((toMs - fromMs) / 86_400_000);
}

function latestCallIsUnsuccessful(client: DirectClient, expectedType: 'incoming' | 'outgoing'): boolean {
  const callType = (client.binotelLatestCallType ?? '').trim().toLowerCase();
  const disp = (client.binotelLatestCallDisposition ?? '').trim().toUpperCase();
  if (callType !== expectedType) return false;
  if (!disp) return false;
  return !['ANSWER', 'VM-SUCCESS', 'SUCCESS'].includes(disp);
}

function isConditionDueToday(client: DirectClient, rule: OboymaDeadlineRule, todayKyiv: string): boolean {
  const c = rule.conditionType;
  if (c === 'future_record' || c === 'past_record') {
    const anchor = (client.paidServiceKyivDay ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return false;
    const diff = daysDiff(todayKyiv, anchor);
    return diff === rule.daysBeforeCondition;
  }
  if (c === 'future_consultation' || c === 'past_consultation') {
    const anchor = (client.consultationBookingKyivDay ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return false;
    const diff = daysDiff(todayKyiv, anchor);
    return diff === rule.daysBeforeCondition;
  }
  if (c === 'days_column') {
    const lastVisitDay = toKyivDay(client.lastVisitAt ?? null);
    if (!lastVisitDay) return false;
    const daysFromVisit = Math.max(0, daysDiff(lastVisitDay, todayKyiv));
    return daysFromVisit === rule.daysBeforeCondition;
  }
  if (c.startsWith('status:')) {
    const statusId = c.slice('status:'.length);
    return statusId.length > 0 && client.statusId === statusId;
  }
  return false;
}

function isTriggerSatisfiedNow(client: DirectClient, triggerKey: string): boolean {
  if (triggerKey.startsWith('state:')) {
    const state = triggerKey.slice('state:'.length);
    return (client.state ?? '') === state;
  }
  switch (triggerKey) {
    case 'record_success':
      return Boolean(client.signedUpForPaidService || client.paidServiceKyivDay);
    case 'consultation_success':
      return Boolean(client.consultationBookingKyivDay || client.consultationAttended);
    case 'cancelled':
      return Boolean(client.paidServiceCancelled || client.consultationCancelled);
    case 'no_show':
      return client.paidServiceAttended === false || client.consultationAttended === false;
    case 'client_arrived':
      return Boolean(client.paidServiceAttended || client.consultationAttended || client.visitedSalon);
    case 'client_waiting':
      return (client.state ?? '') === 'consultation-booked';
    case 'state_not_sold':
      return (client.state ?? '') === 'too-expensive';
    case 'no_rebooking':
      return client.paidServiceIsRebooking === false;
    case 'incoming_unsuccessful_call':
      return latestCallIsUnsuccessful(client, 'incoming');
    case 'outgoing_unsuccessful_call':
      return latestCallIsUnsuccessful(client, 'outgoing');
    case 'days_count':
      return true;
    case 'stub_not_implemented':
      // Тестовий режим: якщо обрано «Заглушка», вважаємо тригер істинним,
      // щоб можна було перевірити створення нагадувань без підключених подій.
      return true;
    default:
      return false;
  }
}

function dedupeMatchesByHistory(client: DirectClient, matches: RuleMatch[]): RuleMatch[] {
  const h = Array.isArray(client.callbackReminderHistory) ? client.callbackReminderHistory : [];
  return matches.filter((m) => {
    return !h.some((e) => (e.scheduledKyivDay ?? '') === m.scheduledKyivDay && (e.note ?? '') === m.comment);
  });
}

export async function runOboymaRulesBatchNow(rules: OboymaDeadlineRule[]): Promise<OboymaRuntimeRunStats> {
  const columnsOk = await ensureDirectCallbackReminderColumnsExist();
  if (columnsOk.ok === false) {
    throw new Error(`Колонки callback reminder недоступні: ${columnsOk.error}`);
  }

  const active = rules.filter((r) => r.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (active.length === 0) {
    const empty = {
      clientsChecked: 0,
      clientsMatched: 0,
      remindersUpdated: 0,
      historyOnlyUpdates: 0,
      matchesTotal: 0,
      byRule: {},
    };
    await kvWrite.setRaw(OBOYMA_RULE_STATS_KV_KEY, JSON.stringify(empty));
    return empty;
  }

  const clients = await getAllDirectClients();
  const today = getTodayKyiv();
  const stats: OboymaRuntimeRunStats = {
    clientsChecked: clients.length,
    clientsMatched: 0,
    remindersUpdated: 0,
    historyOnlyUpdates: 0,
    matchesTotal: 0,
    byRule: {},
  };

  function incCreated(ruleId: string): void {
    const cur = stats.byRule[ruleId] ?? { created: 0, active: 0 };
    cur.created += 1;
    stats.byRule[ruleId] = cur;
  }
  function incActive(ruleId: string): void {
    const cur = stats.byRule[ruleId] ?? { created: 0, active: 0 };
    cur.active += 1;
    stats.byRule[ruleId] = cur;
  }

  for (const client of clients) {
    const candidateMatches: RuleMatch[] = [];
    for (const rule of active) {
      if (!isConditionDueToday(client, rule, today)) continue;
      if (!isTriggerSatisfiedNow(client, rule.triggerKey)) continue;
      const baseDay = addCalendarDaysKyiv(today, rule.daysAfterCondition);
      const scheduledKyivDay = addCalendarDaysKyiv(baseDay, rule.daysAfterTrigger);
      const comment = (rule.comment ?? '').trim();
      if (!comment) continue;
      candidateMatches.push({
        ruleId: rule.id,
        triggerKey: rule.triggerKey,
        scheduledKyivDay,
        comment,
      });
    }

    const matches = dedupeMatchesByHistory(client, candidateMatches);
    if (matches.length === 0) continue;
    for (const m of matches) incCreated(m.ruleId);

    stats.clientsMatched += 1;
    stats.matchesTotal += matches.length;

    const byDay = new Map<string, string[]>();
    for (const m of matches) {
      const arr = byDay.get(m.scheduledKyivDay) ?? [];
      if (!arr.includes(m.comment)) arr.push(m.comment);
      byDay.set(m.scheduledKyivDay, arr);
    }

    // Беремо найближчу дату; для неї ставимо в колонку поточний дедлайн, інші дні — тільки в історію.
    const orderedDays = [...byDay.keys()].sort();
    const primaryDay = orderedDays[0];
    const primaryNote = (byDay.get(primaryDay) ?? []).join('\n');
    const activeRuleIds = new Set(matches.filter((m) => m.scheduledKyivDay === primaryDay).map((m) => m.ruleId));
    for (const rid of activeRuleIds) incActive(rid);

    const hasFuture = hasFutureCallbackReminderKyivDay(client.callbackReminderKyivDay, today);
    if (hasFuture) {
      await appendCallbackReminderHistoryOnly(
        client,
        primaryDay,
        primaryNote,
        'oboyma-batch-history-only',
        { clientId: client.id, rulesMatched: matches.map((m) => m.ruleId) }
      );
      stats.historyOnlyUpdates += 1;
    } else {
      await applyCallbackReminderFullUpdate(
        client,
        primaryDay,
        primaryNote,
        'oboyma-batch',
        { clientId: client.id, rulesMatched: matches.map((m) => m.ruleId) }
      );
      stats.remindersUpdated += 1;
    }

    // Додаткові дати (якщо є) фіксуємо в історії.
    for (let i = 1; i < orderedDays.length; i++) {
      const day = orderedDays[i];
      const note = (byDay.get(day) ?? []).join('\n');
      await appendCallbackReminderHistoryOnly(
        client,
        day,
        note,
        'oboyma-batch-extra-day',
        { clientId: client.id, rulesMatched: matches.map((m) => m.ruleId) }
      );
    }
  }

  console.log('[oboyma/runtime] batch finished:', stats);
  await kvWrite.setRaw(OBOYMA_RULE_STATS_KV_KEY, JSON.stringify(stats));
  return stats;
}

export async function getOboymaRuleStatsFromKV(): Promise<Record<string, { created: number; active: number }>> {
  const raw = await kvRead.getRaw(OBOYMA_RULE_STATS_KV_KEY);
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const candidate = (parsed as any)?.byRule;
    if (!candidate || typeof candidate !== 'object') return {};
    return candidate as Record<string, { created: number; active: number }>;
  } catch {
    return {};
  }
}

