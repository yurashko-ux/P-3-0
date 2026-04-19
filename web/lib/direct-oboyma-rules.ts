// web/lib/direct-oboyma-rules.ts
// Правила «Обойма»: автоматичні дедлайни колонки «Передзвонити» (зберігання в KV).

import { kvRead, kvWrite } from '@/lib/kv';

/** Одне правило конструктора */
export type OboymaDeadlineRule = {
  id: string;
  active: boolean;
  /** Ключ з реєстру OBOYMA_TRIGGER_REGISTRY */
  triggerKey: string;
  /** Зміщення календарних днів від дня події (Europe/Kyiv), залежить від семантики тригера */
  offsetDays: number;
  /** Коментар до дедлайну (як у ручному збереженні) */
  comment: string;
  /** Порядок у списку (менше — вище) */
  order?: number;
};

/** Метадані типу тригера для UI та валідації */
export type OboymaTriggerMeta = {
  key: string;
  labelUk: string;
  descriptionUk: string;
  /** Чи підключено виконання з реальних подій (webhook тощо) */
  implemented: boolean;
};

export const OBOYMA_RULES_KV_KEY = 'direct:oboyma:rules';

/** Розширюваний реєстр тригерів; нові ключі додаються тут перед підключенням логіки */
export const OBOYMA_TRIGGER_REGISTRY: OboymaTriggerMeta[] = [
  {
    key: 'stub_not_implemented',
    labelUk: 'Заглушка (підключення подій згодом)',
    descriptionUk:
      'Правило можна зберігати в конструкторі; автоматичне спрацьовування з подій ще не підключено.',
    implemented: false,
  },
];

const VALID_TRIGGER_KEYS = new Set(OBOYMA_TRIGGER_REGISTRY.map((t) => t.key));

export function isKnownOboymaTriggerKey(key: string): boolean {
  return VALID_TRIGGER_KEYS.has(key);
}

const DEFAULT_RULES: OboymaDeadlineRule[] = [];

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
      return parsed as OboymaDeadlineRule[];
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
    const triggerKey = typeof row.triggerKey === 'string' ? row.triggerKey.trim() : '';
    if (!triggerKey || !isKnownOboymaTriggerKey(triggerKey)) {
      return { ok: false, error: `Правило #${i + 1}: невідомий triggerKey` };
    }
    if (typeof row.offsetDays !== 'number' || !Number.isFinite(row.offsetDays) || !Number.isInteger(row.offsetDays)) {
      return { ok: false, error: `Правило #${i + 1}: offsetDays має бути цілим числом` };
    }
    if (row.offsetDays < -365 || row.offsetDays > 3650) {
      return { ok: false, error: `Правило #${i + 1}: offsetDays поза допустимим діапазоном` };
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
      triggerKey,
      offsetDays: row.offsetDays,
      comment: comment ?? '',
      ...(orderNum !== undefined ? { order: orderNum } : {}),
    });
  }
  return { ok: true, rules: out };
}
