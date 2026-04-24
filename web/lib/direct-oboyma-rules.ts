// web/lib/direct-oboyma-rules.ts
// Правила «Обойма»: автоматичні дедлайни колонки «Передзвонити» (зберігання в KV).

import { kvRead, kvWrite } from '@/lib/kv';
import type { DirectStatus } from '@/lib/direct-types';

/** Одне правило конструктора */
export type OboymaDeadlineRule = {
  id: string;
  active: boolean;
  /** За скільки днів ДО настання умови запускати очікування тригера */
  daysBeforeCondition: number;
  /** Ключ умови з реєстру (base або status:...) */
  conditionType: string;
  /** Додаткове значення умови (за потреби у майбутніх розширеннях) */
  conditionValue?: string;
  /** Зміщення в днях після настання умови */
  daysAfterCondition: number;
  /** Ключ з реєстру тригерів */
  triggerKey: string;
  /** Дні після тригера (дата нагадування) */
  daysAfterTrigger: number;
  /** Коментар до дедлайну (як у ручному збереженні) */
  comment: string;
  /** Порядок у списку (менше — вище) */
  order?: number;
};

/** Метадані типу для UI та валідації */
export type OboymaMetaOption = {
  key: string;
  labelUk: string;
  descriptionUk: string;
  /** Чи підключено виконання з реальних подій (webhook тощо) */
  implemented: boolean;
};

export const OBOYMA_RULES_KV_KEY = 'direct:oboyma:rules';

/** Розширюваний реєстр тригерів; нові ключі додаються тут перед підключенням логіки */
export const OBOYMA_BASE_CONDITION_REGISTRY: OboymaMetaOption[] = [
  {
    key: 'future_record',
    labelUk: 'Майбутній запис',
    descriptionUk: 'Умова: у клієнта є майбутній запис.',
    implemented: false,
  },
  {
    key: 'past_record',
    labelUk: 'Минулий запис',
    descriptionUk: 'Умова: у клієнта є минулий запис.',
    implemented: false,
  },
  {
    key: 'future_consultation',
    labelUk: 'Майбутня консультація',
    descriptionUk: 'Умова: у клієнта є майбутня консультація.',
    implemented: false,
  },
  {
    key: 'past_consultation',
    labelUk: 'Минула консультація',
    descriptionUk: 'Умова: у клієнта є минула консультація.',
    implemented: false,
  },
  {
    key: 'days_column',
    labelUk: 'Днів (з колонки Днів)',
    descriptionUk: 'Умова на основі значення колонки «Днів».',
    implemented: false,
  },
];

/** Розширюваний реєстр тригерів; нові ключі додаються тут перед підключенням логіки */
export const OBOYMA_BASE_TRIGGER_REGISTRY: OboymaMetaOption[] = [
  {
    key: 'stub_not_implemented',
    labelUk: 'Заглушка (підключення подій згодом)',
    descriptionUk:
      'Правило можна зберігати в конструкторі; автоматичне спрацьовування з подій ще не підключено.',
    implemented: false,
  },
  {
    key: 'incoming_unsuccessful_call',
    labelUk: 'Вхідний неуспішний дзвінок',
    descriptionUk: 'Надалі спрацьовуватиме на вхідний дзвінок зі статусом "неуспішний".',
    implemented: false,
  },
  {
    key: 'outgoing_unsuccessful_call',
    labelUk: 'Вихідний неуспішний дзвінок',
    descriptionUk: 'Надалі спрацьовуватиме на вихідний дзвінок зі статусом "неуспішний".',
    implemented: false,
  },
  {
    key: 'record_success',
    labelUk: 'Запис ✅',
    descriptionUk: 'Тригер для події успішного запису; умови будуть додані окремо.',
    implemented: false,
  },
  {
    key: 'consultation_success',
    labelUk: 'Консультація ✅',
    descriptionUk: 'Тригер для успішної консультації; умови будуть додані окремо.',
    implemented: false,
  },
  {
    key: 'days_count',
    labelUk: 'Кількість днів',
    descriptionUk: 'Тригер на основі колонки «Днів»; пороги/оператори буде додано пізніше.',
    implemented: false,
  },
  {
    key: 'state_not_sold',
    labelUk: 'Стан — не продали',
    descriptionUk: 'Тригер для стану клієнта «не продали».',
    implemented: false,
  },
  {
    key: 'no_rebooking',
    labelUk: 'Немає перезапису',
    descriptionUk: 'Тригер для випадку, коли відсутній перезапис.',
    implemented: false,
  },
  {
    key: 'cancelled',
    labelUk: 'Скасував',
    descriptionUk: 'Тригер для події скасування запису/візиту.',
    implemented: false,
  },
  {
    key: 'no_show',
    labelUk: 'Не з’явився',
    descriptionUk: 'Тригер для події no-show.',
    implemented: false,
  },
  {
    key: 'client_arrived',
    labelUk: 'Клієнт прийшов',
    descriptionUk: 'Тригер для події фактичного приходу клієнта.',
    implemented: false,
  },
  {
    key: 'client_waiting',
    labelUk: 'Очікування клієнта',
    descriptionUk: 'Тригер для статусу/стану очікування клієнта.',
    implemented: false,
  },
];

const DIRECT_STATE_META: Array<{ key: string; labelUk: string; descriptionUk: string }> = [
  { key: 'client', labelUk: 'Стан: Клієнт', descriptionUk: 'Тригер по стану client.' },
  { key: 'consultation', labelUk: 'Стан: Консультація', descriptionUk: 'Тригер по стану consultation.' },
  { key: 'consultation-booked', labelUk: 'Стан: Запис на консультацію', descriptionUk: 'Тригер по стану consultation-booked.' },
  { key: 'consultation-no-show', labelUk: 'Стан: Не зʼявився на консультацію', descriptionUk: 'Тригер по стану consultation-no-show.' },
  { key: 'consultation-rescheduled', labelUk: 'Стан: Перенесена консультація', descriptionUk: 'Тригер по стану consultation-rescheduled.' },
  { key: 'hair-extension', labelUk: 'Стан: Нарощування волосся', descriptionUk: 'Тригер по стану hair-extension.' },
  { key: 'other-services', labelUk: 'Стан: Інші послуги', descriptionUk: 'Тригер по стану other-services.' },
  { key: 'all-good', labelUk: 'Стан: Все чудово', descriptionUk: 'Тригер по стану all-good.' },
  { key: 'too-expensive', labelUk: 'Стан: Занадто дорого', descriptionUk: 'Тригер по стану too-expensive.' },
  { key: 'message', labelUk: 'Стан: Повідомлення', descriptionUk: 'Тригер по стану message.' },
  { key: 'binotel-lead', labelUk: 'Стан: Binotel lead', descriptionUk: 'Тригер по стану binotel-lead.' },
];

export function buildStateTriggerRegistry(): OboymaMetaOption[] {
  return DIRECT_STATE_META.map((s) => ({
    key: `state:${s.key}`,
    labelUk: s.labelUk,
    descriptionUk: s.descriptionUk,
    implemented: false,
  }));
}

export function buildOboymaTriggers(): OboymaMetaOption[] {
  return [...OBOYMA_BASE_TRIGGER_REGISTRY, ...buildStateTriggerRegistry()];
}

export function buildOboymaConditions(statuses: DirectStatus[]): OboymaMetaOption[] {
  const statusConditions: OboymaMetaOption[] = statuses
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      key: `status:${s.id}`,
      labelUk: `Статус: ${s.name}`,
      descriptionUk: `Умова по колонці «Статус»: ${s.name}.`,
      implemented: false,
    }));
  return [...OBOYMA_BASE_CONDITION_REGISTRY, ...statusConditions];
}

export function isKnownOboymaTriggerKey(key: string, triggers: OboymaMetaOption[]): boolean {
  const valid = new Set(triggers.map((t) => t.key));
  return valid.has(key);
}

export function isKnownOboymaConditionType(key: string, conditions: OboymaMetaOption[]): boolean {
  const valid = new Set(conditions.map((c) => c.key));
  return valid.has(key);
}

const DEFAULT_RULES: OboymaDeadlineRule[] = [];

function toV2Rule(raw: Record<string, unknown>): OboymaDeadlineRule | null {
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  if (!id) return null;
  const active = typeof raw.active === 'boolean' ? raw.active : true;
  const comment = normalizeOboymaComment(raw.comment) ?? '';
  const order = typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : undefined;

  // Нова схема
  if (typeof raw.triggerKey === 'string' && typeof raw.conditionType === 'string') {
    return {
      id,
      active,
      daysBeforeCondition:
        typeof raw.daysBeforeCondition === 'number' && Number.isFinite(raw.daysBeforeCondition)
          ? Math.trunc(raw.daysBeforeCondition)
          : 0,
      conditionType: raw.conditionType.trim(),
      ...(typeof raw.conditionValue === 'string' && raw.conditionValue.trim()
        ? { conditionValue: raw.conditionValue.trim() }
        : {}),
      daysAfterCondition:
        typeof raw.daysAfterCondition === 'number' && Number.isFinite(raw.daysAfterCondition)
          ? Math.trunc(raw.daysAfterCondition)
          : 0,
      triggerKey: raw.triggerKey.trim(),
      daysAfterTrigger:
        typeof raw.daysAfterTrigger === 'number' && Number.isFinite(raw.daysAfterTrigger)
          ? Math.trunc(raw.daysAfterTrigger)
          : 0,
      comment,
      ...(order !== undefined ? { order } : {}),
    };
  }

  // Стара схема сумісності (offsetDays + triggerKey)
  if (typeof raw.triggerKey === 'string' && typeof raw.offsetDays === 'number') {
    return {
      id,
      active,
      daysBeforeCondition: 0,
      conditionType: 'future_record',
      daysAfterCondition: 0,
      triggerKey: raw.triggerKey.trim(),
      daysAfterTrigger: Math.trunc(raw.offsetDays),
      comment,
      ...(order !== undefined ? { order } : {}),
    };
  }
  return null;
}

function parseRulesFromKvRaw(rulesRaw: unknown): OboymaDeadlineRule[] | null {
  try {
    let parsed: unknown = rulesRaw;
    if (typeof rulesRaw === 'string') {
      try {
        parsed = JSON.parse(rulesRaw);
      } catch {
        parsed = rulesRaw;
      }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      const candidate = o.value ?? o.result ?? o.data;
      if (candidate !== undefined) {
        if (typeof candidate === 'string') {
          try {
            parsed = JSON.parse(candidate);
          } catch {
            parsed = candidate;
          }
        } else {
          parsed = candidate;
        }
      }
    }
    if (Array.isArray(parsed)) {
      const normalized: OboymaDeadlineRule[] = [];
      for (const r of parsed) {
        if (!r || typeof r !== 'object') continue;
        const v2 = toV2Rule(r as Record<string, unknown>);
        if (v2) normalized.push(v2);
      }
      return normalized;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function getOboymaRulesFromKV(): Promise<OboymaDeadlineRule[]> {
  const rulesRaw = await kvRead.getRaw(OBOYMA_RULES_KV_KEY);
  if (!rulesRaw) return [...DEFAULT_RULES];
  const parsed = parseRulesFromKvRaw(rulesRaw);
  if (parsed && parsed.length >= 0) return parsed;
  console.warn('[oboyma/rules] Не вдалося розпарсити правила з KV, повертаємо порожній список');
  return [...DEFAULT_RULES];
}

export async function saveOboymaRulesToKV(rules: OboymaDeadlineRule[]): Promise<void> {
  await kvWrite.setRaw(OBOYMA_RULES_KV_KEY, JSON.stringify(rules));
}

const NOTE_MAX = 2000;

export function normalizeOboymaComment(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length ? t.slice(0, NOTE_MAX) : null;
}

export function validateOboymaRulesPayload(rules: unknown): { ok: true; rules: OboymaDeadlineRule[] } | { ok: false; error: string } {
  return validateOboymaRulesPayloadWithCatalogs(
    rules,
    OBOYMA_BASE_CONDITION_REGISTRY,
    OBOYMA_BASE_TRIGGER_REGISTRY
  );
}

export function validateOboymaRulesPayloadWithCatalogs(
  rules: unknown,
  conditions: OboymaMetaOption[],
  triggers: OboymaMetaOption[]
): { ok: true; rules: OboymaDeadlineRule[] } | { ok: false; error: string } {
  if (!Array.isArray(rules)) {
    return { ok: false, error: 'rules має бути масивом' };
  }
  const out: OboymaDeadlineRule[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (!r || typeof r !== 'object') {
      return { ok: false, error: `Правило #${i + 1}: невалідний об'єкт` };
    }
    const row = r as Record<string, unknown>;
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : '';
    if (!id) return { ok: false, error: `Правило #${i + 1}: потрібен id` };
    if (seenIds.has(id)) return { ok: false, error: `Дубль id: ${id}` };
    seenIds.add(id);
    if (typeof row.active !== 'boolean') {
      return { ok: false, error: `Правило #${i + 1}: active має бути boolean` };
    }
    const conditionType = typeof row.conditionType === 'string' ? row.conditionType.trim() : '';
    if (!conditionType || !isKnownOboymaConditionType(conditionType, conditions)) {
      return { ok: false, error: `Правило #${i + 1}: невідомий conditionType` };
    }
    const triggerKey = typeof row.triggerKey === 'string' ? row.triggerKey.trim() : '';
    if (!triggerKey || !isKnownOboymaTriggerKey(triggerKey, triggers)) {
      return { ok: false, error: `Правило #${i + 1}: невідомий triggerKey` };
    }
    if (typeof row.daysBeforeCondition !== 'number' || !Number.isFinite(row.daysBeforeCondition) || !Number.isInteger(row.daysBeforeCondition)) {
      return { ok: false, error: `Правило #${i + 1}: daysBeforeCondition має бути цілим числом` };
    }
    if (row.daysBeforeCondition < 0 || row.daysBeforeCondition > 3650) {
      return { ok: false, error: `Правило #${i + 1}: daysBeforeCondition поза діапазоном` };
    }
    if (typeof row.daysAfterCondition !== 'number' || !Number.isFinite(row.daysAfterCondition) || !Number.isInteger(row.daysAfterCondition)) {
      return { ok: false, error: `Правило #${i + 1}: daysAfterCondition має бути цілим числом` };
    }
    if (row.daysAfterCondition < -365 || row.daysAfterCondition > 3650) {
      return { ok: false, error: `Правило #${i + 1}: daysAfterCondition поза діапазоном` };
    }
    if (typeof row.daysAfterTrigger !== 'number' || !Number.isFinite(row.daysAfterTrigger) || !Number.isInteger(row.daysAfterTrigger)) {
      return { ok: false, error: `Правило #${i + 1}: daysAfterTrigger має бути цілим числом` };
    }
    if (row.daysAfterTrigger < -365 || row.daysAfterTrigger > 3650) {
      return { ok: false, error: `Правило #${i + 1}: daysAfterTrigger поза діапазоном` };
    }
    if (typeof row.comment !== 'string') {
      return { ok: false, error: `Правило #${i + 1}: comment має бути рядком` };
    }
    const comment = normalizeOboymaComment(row.comment);
    const order = row.order;
    const orderNum =
      order === undefined || order === null
        ? undefined
        : typeof order === 'number' && Number.isFinite(order)
          ? order
          : undefined;
    out.push({
      id,
      active: row.active,
      daysBeforeCondition: row.daysBeforeCondition,
      conditionType,
      ...(typeof row.conditionValue === 'string' && row.conditionValue.trim()
        ? { conditionValue: row.conditionValue.trim() }
        : {}),
      daysAfterCondition: row.daysAfterCondition,
      triggerKey,
      daysAfterTrigger: row.daysAfterTrigger,
      comment: comment ?? '',
      ...(orderNum !== undefined ? { order: orderNum } : {}),
    });
  }
  return { ok: true, rules: out };
}
