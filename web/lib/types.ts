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
  // Послаблюємо вимогу до UUID, щоб підтримати існуючі id
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

export function normalizeCampaign(input: CampaignInput): Campaign {
  const parsed = CampaignSchema.parse(input);

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
