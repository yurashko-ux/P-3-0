// web/lib/types.ts
import { z } from 'zod';

const Num = z.coerce.number();

export const RuleSchema = z.object({
  op: z.enum(['contains', 'equals']).default('contains'),
  value: z.string().trim().default(''),
});

export const V1RuleSchema = RuleSchema.extend({
  value: z.string().trim().min(1, 'rules.v1.value is required (non-empty)'),
});

export const CampaignSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1),
  created_at: Num.optional(),
  active: z.coerce.boolean().default(false),
  base_pipeline_id: Num,
  base_status_id: Num,
  rules: z.object({
    v1: V1RuleSchema,
    v2: RuleSchema.optional(),
  }),
  exp: z
    .object({
      days: Num.int().positive().optional(),
      to_pipeline_id: Num.optional(),
      to_status_id: Num.optional(),
    })
    .optional(),
  v1_count: Num.int().nonnegative().optional(),
  v2_count: Num.int().nonnegative().optional(),
  exp_count: Num.int().nonnegative().optional(),
});

export type CampaignInput = z.input<typeof CampaignSchema>;

export type Campaign = Omit<z.output<typeof CampaignSchema>, 'id' | 'created_at' | 'rules'> & {
  id: string;
  created_at: number;
  rules: {
    v1: z.output<typeof V1RuleSchema>;
    v2: z.output<typeof RuleSchema>;
  };
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  exp?:
    | (z.output<typeof CampaignSchema>['exp'] & {
        to_pipeline_name?: string | null;
        to_status_name?: string | null;
      })
    | undefined;
};

// ---------------- helpers ----------------
const toStr = (v: any) =>
  v === undefined || v === null ? undefined : String(v);

const trim = (v: any) => {
  const s = toStr(v);
  return s === undefined ? undefined : s.trim();
};

function coerceBool(v: any) {
  return v === true || v === 'true' || v === '1' || v === 1;
}
function coerceNum(v: any) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// пошук по багатьох можливих ключах + «розумний» пошук по патерну
function pickFirst(...vals: any[]) {
  for (const v of vals) {
    const t = trim(v);
    if (t !== undefined && t !== '') return t;
  }
  return undefined;
}

// рекурсивний пошук значення за RegExp по ключах максимум на 2 рівнях
function findByKeyPattern(input: any, regex: RegExp): string | undefined {
  if (!input || typeof input !== 'object') return undefined;

  for (const [k, v] of Object.entries(input)) {
    if (regex.test(k.toLowerCase())) {
      const t = trim(v);
      if (t) return t;
    }
    if (v && typeof v === 'object') {
      for (const [kk, vv] of Object.entries(v as any)) {
        const full = `${k}.${kk}`.toLowerCase();
        if (regex.test(kk.toLowerCase()) || regex.test(full)) {
          const t = trim(vv);
          if (t) return t;
        }
      }
    }
  }
  return undefined;
}

// Підготовка payload з підтримкою «будь-яких» назв для V1/V2
function prepareCampaignInput(input: any): CampaignInput {
  const rules = input.rules ?? {};

  // ---- V1 ----
  const v1op =
    pickFirst(
      rules?.v1?.op,
      input.v1_op,
      input.rules_v1_op,
      input.v1Op,
      input.v1Operator,
      findByKeyPattern(input, /(^|\.)(v1).*op(erator)?$/i)
    ) ?? 'contains';

  const v1val =
    pickFirst(
      rules?.v1?.value,
      input.v1_value,
      input.rules_v1_value,
      input.v1Value,
      input.v1,
      input.v1_text,
      input.v1Text,
      input.keyword,
      input.trigger,
      input.rule_v1_value,
      input.value,           // частий кейс форм
      input.value1,
      input.variant1_value,
      input['variant1.value'],
      input['v1.value'],
      input['rules.v1.value'],
      findByKeyPattern(input, /(^|\.)(v1).*val(ue)?$/i), // патерн: будь-який ключ з v1 і value
      findByKeyPattern(input, /(^|\.)(variant1).*val(ue)?$/i)
    ) ?? '';

  // ---- V2 ----
  const v2op =
    pickFirst(
      rules?.v2?.op,
      input.v2_op,
      input.rules_v2_op,
      input.v2Op,
      input.v2Operator,
      findByKeyPattern(input, /(^|\.)(v2).*op(erator)?$/i)
    ) ?? 'contains';

  const v2val =
    pickFirst(
      rules?.v2?.value,
      input.v2_value,
      input.rules_v2_value,
      input.v2Value,
      input.v2,
      input.v2_text,
      input.v2Text,
      input.rule_v2_value,
      input.value2,
      input.variant2_value,
      input['variant2.value'],
      input['v2.value'],
      input['rules.v2.value'],
      findByKeyPattern(input, /(^|\.)(v2).*val(ue)?$/i),
      findByKeyPattern(input, /(^|\.)(variant2).*val(ue)?$/i)
    );

  const expDays = pickFirst(input.exp?.days, input.exp_days);
  const expToPipeline = pickFirst(input.exp?.to_pipeline_id, input.exp_to_pipeline_id);
  const expToStatus = pickFirst(input.exp?.to_status_id, input.exp_to_status_id);

  const prepared: any = {
    id: trim(input.id),
    name: trim(input.name),
    created_at: coerceNum(input.created_at),
    active: input.active !== undefined ? coerceBool(input.active) : undefined,
    base_pipeline_id:
      coerceNum(input.base_pipeline_id ?? input.pipeline_id) ?? undefined,
    base_status_id:
      coerceNum(input.base_status_id ?? input.status_id) ?? undefined,
    rules: {
      v1: { op: v1op, value: v1val }, // V1 обовʼязково (перевірить Zod)
      ...(v2op !== undefined || v2val !== undefined
        ? { v2: { op: v2op, value: v2val ?? '' } }
        : {}),
    },
    ...(expDays !== undefined || expToPipeline !== undefined || expToStatus !== undefined
      ? {
          exp: {
            days: coerceNum(expDays),
            to_pipeline_id: coerceNum(expToPipeline),
            to_status_id: coerceNum(expToStatus),
          },
        }
      : {}),
    v1_count: coerceNum(input.v1_count),
    v2_count: coerceNum(input.v2_count),
    exp_count: coerceNum(input.exp_count),
  };

  return prepared;
}

export function normalizeCampaign(input: CampaignInput): Campaign {
  // 1) Мʼяка підготовка payload
  const prepared = prepareCampaignInput(input);

  // 2) Валідація/коерс через Zod
  const parsed = CampaignSchema.parse(prepared);

  // 3) Гарантовані поля
  const id =
    parsed.id ??
    (globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2));
  const created_at = parsed.created_at ?? Date.now();

  const rules = {
    v1: parsed.rules.v1,
    v2: parsed.rules.v2 ?? { op: 'contains', value: '' },
  } as const;

  return {
    ...parsed,
    id,
    created_at,
    active: parsed.active ?? false,
    rules,
    v1_count: parsed.v1_count ?? 0,
    v2_count: parsed.v2_count ?? 0,
    exp_count: parsed.exp_count ?? 0,
  };
}
