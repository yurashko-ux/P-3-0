// web/lib/types.ts
// Zod-схеми + типи + normalizeCampaign() без рекурсивних посилань на власні типи.

import { z } from "zod";

// -------------------- Rule --------------------

export const RuleSchema = z.object({
  op: z.enum(["contains", "equals"]).default("contains"),
  value: z.string().default(""),
});
export type Rule = z.infer<typeof RuleSchema>;

// -------------------- EXP (expiration / move after N days) --------------------

export const ExpSchema = z
  .object({
    days: z.number().int().positive().default(7),
    to_pipeline_id: z.number().int().positive(),
    to_status_id: z.number().int().positive(),
  })
  .strict();
export type Exp = z.infer<typeof ExpSchema>;

// -------------------- Campaign (базова сутність, як у контракті) --------------------

export const CampaignSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    created_at: z.number().int().nonnegative(),
    active: z.boolean().default(false),

    base_pipeline_id: z.number().int().positive(),
    base_status_id: z.number().int().positive(),

    rules: z
      .object({
        v1: RuleSchema,
        v2: RuleSchema,
      })
      .strict(),

    exp: ExpSchema.optional(),

    v1_count: z.number().int().nonnegative().default(0),
    v2_count: z.number().int().nonnegative().default(0),
    exp_count: z.number().int().nonnegative().default(0),
  })
  .strict();

export type Campaign = z.infer<typeof CampaignSchema>;

// -------------------- Enriched Campaign (із назвами для UI/GET) --------------------
// ВАЖЛИВО: не використовуємо Campaign["exp"] у визначенні — щоб уникнути циклічної типізації.

export type CampaignEnriched = Campaign & {
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  exp?: (Exp & {
    to_pipeline_name?: string | null;
    to_status_name?: string | null;
  }) | null;
};

// -------------------- normalizeCampaign --------------------

/**
 * Приймає сирий input (з форми/POST), повертає валідований Campaign
 * з гарантованими rules.v1/rules.v2, лічильниками = 0, id/created_at за потреби.
 */
export function normalizeCampaign(input: unknown): Campaign {
  // Допоміжні значення
  const now = Date.now();
  const uuid = () =>
    (globalThis.crypto?.randomUUID?.() ??
      // fallback (не крипто) — тільки щоб білд не падав у середовищах без crypto
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      })) as string;

  // Розкладаємо вхідні дані, ставимо дефолти на rules.v1/v2 навіть якщо немає rules взагалі
  const raw = (input ?? {}) as any;

  const base = {
    id: typeof raw.id === "string" ? raw.id : uuid(),
    name: typeof raw.name === "string" ? raw.name : "Campaign",
    created_at:
      typeof raw.created_at === "number" && Number.isFinite(raw.created_at)
        ? raw.created_at
        : now,
    active: !!raw.active,

    base_pipeline_id: Number(raw.base_pipeline_id),
    base_status_id: Number(raw.base_status_id),

    rules: {
      v1: {
        op:
          raw?.rules?.v1?.op === "equals" || raw?.rules?.v1?.op === "contains"
            ? (raw.rules.v1.op as Rule["op"])
            : "contains",
        value: typeof raw?.rules?.v1?.value === "string" ? raw.rules.v1.value : "",
      },
      v2: {
        op:
          raw?.rules?.v2?.op === "equals" || raw?.rules?.v2?.op === "contains"
            ? (raw.rules.v2.op as Rule["op"])
            : "contains",
        value: typeof raw?.rules?.v2?.value === "string" ? raw.rules.v2.value : "",
      },
    },

    // exp може бути відсутнім
    exp:
      raw?.exp && typeof raw.exp === "object"
        ? {
            days:
              typeof raw.exp.days === "number" && Number.isFinite(raw.exp.days) && raw.exp.days > 0
                ? Math.trunc(raw.exp.days)
                : 7,
            to_pipeline_id: Number(raw.exp.to_pipeline_id),
            to_status_id: Number(raw.exp.to_status_id),
          }
        : undefined,

    v1_count: Number.isFinite(raw.v1_count) ? Math.max(0, Math.trunc(raw.v1_count)) : 0,
    v2_count: Number.isFinite(raw.v2_count) ? Math.max(0, Math.trunc(raw.v2_count)) : 0,
    exp_count: Number.isFinite(raw.exp_count) ? Math.max(0, Math.trunc(raw.exp_count)) : 0,
  };

  // Валідація через Zod: це також гарантує позитивність id-шників
  const parsed = CampaignSchema.safeParse(base);
  if (!parsed.success) {
    // Кидаємо компактну помилку з повідомленнями Zod
    const msg = parsed.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join("; ");
    throw new Error(`Invalid campaign: ${msg}`);
  }

  return parsed.data;
}

// Зручні ре-експорти на випадок використання в інших місцях
export const Schemas = { RuleSchema, ExpSchema, CampaignSchema };
export type { Campaign as CampaignType, CampaignEnriched as CampaignWithNames };
