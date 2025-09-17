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
  // Не вимагаємо UUID, підтримуємо довільні рядкові id
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

// Нормалізований тип (гарантуємо string id та number created_at)
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

// Допоміжні коерсери
function coerceBool(v: any) {
  return v === true || v === 'true' || v === '1' || v === 1;
}
function coerceNum(v: any) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function trim(v: any) {
  return v === undefined || v === null ? undefined : String(v).trim();
}

// Підтримка пласких формових полів: v1_op/v1_value, v2_op/v2_value, exp_days, ...
function prepareCampaignInput(input: any): CampaignInput {
  const rules = input.rules ?? {};
  const v1op = rules?.v1?.op ?? input.v1_op ?? input.rules_v1_op ?? 'contains';
  const v1val = rules?.v1?.value ?? input.v1_value ?? input.rules_v1_value ?? '';
  const v2op = rules?.v2?.op ?? input.v2_op ?? input.rules_v2_op ?? 'contains';
  const v2val = rules?.v2?.value ?? input.v2_value ?? input.rules_v2_value ?? '';

  const expDays = input.exp?.days ?? input.exp_days;
  const expToPipeline = input.exp?.to_pipeline_id ?? input.exp_to_pipeline_id;
  const expToStatus = input.exp?.to_status_id ?? input.exp_to_status_id;

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
      v1: { op: v1op, value: trim(v1val) ?? '' },
      // v2 додаємо лише якщо хоч щось передано; бекенд все одно заповнить дефолт
      ...(v2op !== undefined || v2val !== undefined
        ? { v2: { op: v2op, value: trim(v2val) ?? '' } }
        : {}),
    },
    // exp додаємо лише якщо є хоч одне поле
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
  // 1) М’яка підготовка payload (підтримка пласких форм)
  const prepared = prepareCampaignInput(input);
  // 2) Валідація/коерс через Zod
  const parsed = CampaignSchema.parse(prepared);

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
