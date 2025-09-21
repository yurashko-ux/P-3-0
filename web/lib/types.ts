// web/lib/types.ts
import { z } from "zod";

export const RuleSchema = z.object({
  op: z.enum(["contains", "equals"]).default("contains"),
  value: z.string().trim().default(""),
});

export const V1RuleSchema = RuleSchema.extend({
  value: z.string().trim().min(1, "rules.v1.value is required (non-empty)"),
});

export const CampaignSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1),
  created_at: z.number().optional(),
  active: z.boolean().default(false),
  base_pipeline_id: z.number(),
  base_status_id: z.number(),
  rules: z.object({
    v1: V1RuleSchema,
    v2: RuleSchema.optional(),
  }),
  exp: z
    .object({
      days: z.number().int().positive().optional(),
      to_pipeline_id: z.number().optional(),
      to_status_id: z.number().optional(),
    })
    .optional(),
  v1_count: z.number().int().nonnegative().optional(),
  v2_count: z.number().int().nonnegative().optional(),
  exp_count: z.number().int().nonnegative().optional(),
});

export type CampaignInput = z.input<typeof CampaignSchema>;
export type Campaign = z.output<typeof CampaignSchema> & {
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  exp?: Campaign["exp"] & {
    to_pipeline_name?: string | null;
    to_status_name?: string | null;
  };
};

export function normalizeCampaign(input: CampaignInput): Campaign {
  const parsed = CampaignSchema.parse(input);
  const id = parsed.id ?? crypto.randomUUID();
  const created_at = parsed.created_at ?? Date.now();
  const rules = {
    v1: parsed.rules.v1,
    v2: parsed.rules.v2 ?? { op: "contains", value: "" },
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
