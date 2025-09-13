// app/api/campaigns/validate/route.ts
/**
 * Перевірка унікальності варіантів (V1/V2) між активними кампаніями.
 * Виклик: POST /api/campaigns/validate  (тіло: частковий об'єкт кампанії)
 * Повертає 200 {ok:true} якщо конфліктів немає, або 409 з деталями конфліктів.
 */

import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic";

type Maybe<T> = T | undefined | null;

type Campaign = {
  id: string | number;
  name?: string;
  enabled?: boolean;
  is_active?: boolean;
  archived?: boolean;
  rules?: {
    v1?: { enabled?: boolean; value?: string | null };
    v2?: { enabled?: boolean; value?: string | null };
  };
};

function norm(val: Maybe<string>): string | null {
  if (val == null) return null;
  const s = String(val).trim().toLowerCase();
  return s.length ? s : null;
}

function isActiveCampaign(c: any): boolean {
  if (!c) return false;
  if (c.archived === true) return false;
  if (c.enabled === false) return false;
  if (c.is_active === false) return false;
  // за замовчуванням вважаємо активною
  return true;
}

function extractVariants(c: Campaign): string[] {
  const out: string[] = [];
  const v1 = norm(c?.rules?.v1?.value);
  const v2 = norm(c?.rules?.v2?.value);
  const v1enabled = c?.rules?.v1?.enabled !== false; // V1 має бути валідним/увімкненим
  const v2enabled = c?.rules?.v2?.enabled === true;  // V2 опційний: враховуємо лише коли явно увімкнено

  if (v1 && v1enabled) out.push(v1);
  if (v2 && v2enabled) out.push(v2);

  // унікалізуємо всередині кампанії
  return Array.from(new Set(out));
}

async function listAllCampaignIds(): Promise<string[]> {
  const zr = (await kvZRange("campaigns:index", 0, -1)) as any;
  // Підтримка обох форматів: [member] або [{member, score}]
  const ids = Array.isArray(zr) ? zr.map((x: any) => String(x?.member ?? x)) : [];
  return ids.filter(Boolean);
}

async function loadCampaign(id: string): Promise<Campaign | null> {
  const raw = await kvGet(`campaigns:${id}`);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? (JSON.parse(raw) as Campaign) : (raw as Campaign);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  await assertAdmin(req);

  const candidate: Campaign = await req.json().catch(() => ({} as Campaign));
  const candidateId = candidate?.id != null ? String(candidate.id) : null;
  const candidateVariants = extractVariants(candidate);

  // Внутрішній дублікат у межах однієї кампанії (V1 === V2)
  if (candidateVariants.length < (candidate.rules?.v2?.enabled ? 2 : 1)) {
    // Якщо V2 увімкнено, але після нормалізації значення збіглися — це локальний конфлікт
    const v1 = norm(candidate?.rules?.v1?.value);
    const v2 = candidate?.rules?.v2?.enabled ? norm(candidate?.rules?.v2?.value) : null;
    if (v1 && v2 && v1 === v2) {
      return NextResponse.json(
        {
          ok: false,
          error: "variant_conflict_same_campaign",
          message: "V1 і V2 мають однакове значення у цій кампанії.",
          conflicts: [{ value: v1, with: "self" }],
        },
        { status: 409 }
      );
    }
  }

  // Якщо у кандидата взагалі немає валідних варіантів — пропускаємо перевірку як успішну
  if (candidateVariants.length === 0) {
    return NextResponse.json({ ok: true, note: "no_variants_in_candidate" });
  }

  const ids = await listAllCampaignIds();
  const conflicts: Array<{ value: string; campaignId: string; campaignName?: string }> = [];

  for (const id of ids) {
    if (candidateId && id === candidateId) continue; // не порівнюємо із самим собою при оновленні

    const c = await loadCampaign(id);
    if (!c) continue;
    if (!isActiveCampaign(c)) continue;

    const otherVariants = extractVariants(c);
    // перетин множин (по значенню)
    for (const val of candidateVariants) {
      if (otherVariants.includes(val)) {
        conflicts.push({
          value: val,
          campaignId: String(c.id ?? id),
          campaignName: c.name,
        });
      }
    }
  }

  if (conflicts.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "variant_conflict",
        message:
          "Значення варіанта (V1/V2) вже використовується в іншій активній кампанії. Змініть значення або вимкніть ту кампанію.",
        conflicts,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}
