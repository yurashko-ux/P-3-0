// web/lib/campaigns-unique.ts
// Утиліти перевірки унікальності значень V1/V2 між кампаніями.
// Файл самодостатній, не має звернень до змінних поза скоупом (ніякого `res` на верхньому рівні).

export type CampaignRule = {
  op: 'contains' | 'equals' | string;
  value: string;
};

export type Campaign = {
  id: string | number;
  name?: string;
  rules?: {
    v1?: CampaignRule | null;
    v2?: CampaignRule | null;
  } | null;
};

export type Conflict = {
  which: 'v1' | 'v2';
  value: string;
  campaignId: string | number;
};

export type UniquenessResult =
  | { ok: true }
  | { ok: false; conflicts: Conflict[] };

/**
 * Витягує нормалізовані значення варіантів (V1/V2) з кампанії.
 */
function getVariantValues(c: Campaign): Array<{ which: 'v1' | 'v2'; value: string }> {
  const out: Array<{ which: 'v1' | 'v2'; value: string }> = [];
  const v1 = c?.rules?.v1?.value ?? '';
  const v2 = c?.rules?.v2?.value ?? '';
  if (v1) out.push({ which: 'v1', value: String(v1).trim().toLowerCase() });
  if (v2) out.push({ which: 'v2', value: String(v2).trim().toLowerCase() });
  return out;
}

/**
 * Перевіряє унікальність значень V1/V2 для `candidate` відносно `others`.
 * Повертає список конфліктів (якщо є).
 */
export function checkCampaignVariantsUniqueness(
  candidate: Campaign,
  others: Campaign[]
): UniquenessResult {
  const candVals = getVariantValues(candidate);
  if (candVals.length === 0) return { ok: true };

  const conflicts: Conflict[] = [];
  for (const other of others || []) {
    if (!other) continue;
    const otherVals = getVariantValues(other);
    for (const cv of candVals) {
      for (const ov of otherVals) {
        if (cv.value && ov.value && cv.value === ov.value) {
          conflicts.push({
            which: cv.which,
            value: cv.value,
            campaignId: other.id,
          });
        }
      }
    }
  }

  if (conflicts.length) return { ok: false, conflicts };
  return { ok: true };
}

/**
 * Формує людиночитний меседж про конфлікти.
 */
export function summarizeConflicts(res: UniquenessResult): string {
  const conflicts =
    (res as any)?.conflicts as
      | Array<{ which: string; value: string; campaignId: string | number }>
      | undefined;

  const msg =
    'Variant values must be unique across campaigns. Conflicts: ' +
    (conflicts && conflicts.length
      ? conflicts
          .map(
            (c) =>
              `[${c.which}] "${c.value}" already used in campaign ${c.campaignId}`
          )
          .join('; ')
      : 'none');

  return msg;
}

/**
 * Кидає помилку, якщо знайдено конфлікти. Інакше — нічого не робить.
 */
export function assertCampaignVariantsUnique(
  candidate: Campaign,
  others: Campaign[]
): void {
  const res = checkCampaignVariantsUniqueness(candidate, others);
  if ('ok' in res && res.ok) return;
  throw new Error(summarizeConflicts(res));
}

/** Зручний default-експорт з усіма корисними штуками. */
const api = {
  checkCampaignVariantsUniqueness,
  summarizeConflicts,
  assertCampaignVariantsUnique,
};
export default api;
