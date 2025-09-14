// web/app/api/campaigns/create/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { kvSet, kvZAdd } from "@/lib/kv";
import { assertVariantsUniqueOrThrow } from "@/lib/campaigns-unique";

const OpEnum = z.enum(["contains", "equals"]);

const RuleV1Schema = z.object({
  // field завжди 'text', але приймаємо як необовʼязкове і дефолтимо
  field: z.literal("text").optional().default("text"),
  op: OpEnum,
  // ГОЛОВНЕ: коерс у рядок + trim + non-empty
  value: z.coerce.string().trim().min(1, "rules.v1.value is required (non-empty)"),
});

const RuleV2Schema = z
  .object({
    field: z.literal("text").optional().default("text"),
    op: OpEnum,
    // коерс у рядок + trim, але БЕЗ min(1) — порожнє значення означає, що v2 відключено
    value: z.coerce.string().trim().optional(),
  })
  .optional();

const ExpireSchema = z
  .object({
    days: z.coerce.number().int().min(1),
    to_pipeline_id: z.coerce.number().int().positive(),
    to_status_id: z.coerce.number().int().positive(),
  })
  .optional();

const BodySchema = z.object({
  name: z.coerce.string().trim().min(1),
  base_pipeline_id: z.coerce.number().int().positive(),
  base_status_id: z.coerce.number().int().positive(),
  rules: z.object({
    v1: RuleV1Schema,
    v2: RuleV2Schema,
  }),
  expire: ExpireSchema,
});

type Body = z.infer<typeof BodySchema>;

export async function POST(req: Request) {
  await assertAdmin(req);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    // повертаємо перше зрозуміле повідомлення (включно з rules.v1.value…)
    const msg =
      parsed.error.issues[0]?.message || "Validation error in request body";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  const body: Body = parsed.data;

  // Нормалізуємо v2: якщо value відсутнє або порожнє — взагалі прибираємо v2
  const v2 =
    body.rules.v2 && body.rules.v2.value
      ? {
          field: "text" as const,
          op: body.rules.v2.op,
          value: body.rules.v2.value,
        }
      : undefined;

  // Перевірка унікальності варіантів (по всіх НЕ видалених кампаніях)
  await assertVariantsUniqueOrThrow({
    v1: { field: "text", op: body.rules.v1.op, value: body.rules.v1.value },
    v2,
  });

  const now = Date.now();
  const id = now; // простий ID на базі часу

  const created = {
    id,
    name: body.name,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    active: true as const,

    base_pipeline_id: body.base_pipeline_id,
    base_status_id: body.base_status_id,

    rules: {
      v1: {
        field: "text" as const,
        op: body.rules.v1.op,
        value: body.rules.v1.value,
      },
      ...(v2 ? { v2 } : {}),
    },

    expire: body.expire
      ? {
        days: body.expire.days,
        to_pipeline_id: body.expire.to_pipeline_id,
        to_status_id: body.expire.to_status_id,
      }
      : undefined,

    // стартові лічильники
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  // Зберігаємо
  await kvSet(`campaigns:${id}`, JSON.stringify(created));
  await kvZAdd("campaigns:index", now, String(id));

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
