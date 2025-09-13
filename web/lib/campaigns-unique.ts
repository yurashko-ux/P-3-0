// web/lib/campaigns-unique.ts
import { kvGet, kvZRange } from "@/lib/kv";

type VariantOp = "contains" | "equals";
type VariantField = "text";

export type VariantRule = {
  enabled?: boolean;
  field?: VariantField;
  op?: VariantOp;
  value?: string;
};

export type Campaign = {
  id: string | number;
  name?: string;
  deleted?: boolean;
  deleted_at?: string | null;
  status?: string | null; // e.g. "deleted"
  rules?: {
    v1?: VariantRule;
    v2?: VariantRule;
  };
};

/** нормалізація рядка для унікальності: trim + lower */
function normVariant(v?: string): string | null {
  const s = (v ?? "").trim().toLowerCase();
  return s.length ? s : null;
}

/** вважаємо видаленою, якщо будь-яка з ознак «видалено» присутня */
function isDeletedCampaign(c?: Campaign | null): boolean {
  if (!c) return true;
  if (c.deleted === true) return true;
  if (c.status && String(c.status).toLowerCase() === "deleted") return true;
  if (c.deleted_at) return true;
  return false;
}

export type UniquenessResult =
  | { ok: true }
  | {
      ok: false;
      conflicts: Array<{
        which: "v1" | "v2";
        value: string;
        campaignId: string | number;
        campaignName?: string;
      }>;
    };

/**
 * Перевіряє унікальність варіантів V1/V2 серед усіх існуючих не-видалених кампаній.
 * excludeId — ігнорує кампанію з цим id (щоб дозволити редагування без помилкових конфліктів).
 */
export async function checkVariantUniqueness(params: {
  v1?: VariantRule;
  v2?: VariantRule;
  excludeId?: string | number;
}): Promise<UniquenessResult> {
  const wantV1 = normVariant(params.v1?.value);
  const wantV2 = normVariant(params.v2?.value);

  // Якщо немає жодного значення — конфліктів немає.
  if (!wantV1 && !wantV2) return { ok: true };

  // Збираємо всі кампанії з KV
  const ids = (await kvZRange("campaigns:index", 0, -1)) as string[]; // список id (string)
  // Мапа значення → { id, name, which }
  const taken = new Map<
    string,
    { campaignId: string | number; campaignName?: string; which: "v1" | "v2" }
  >();

  for (const id of ids || []) {
    if (params.excludeId != null && String(params.excludeId) === String(id)) {
      continue; // пропускаємо поточну кампанію при редагуванні
    }
    const raw = await kvGet(`campaigns:${id}`);
    if (!raw) continue;

    let c: Campaign | null = null;
    try {
      c = typeof raw === "string" ? (JSON.parse(raw) as Campaign) : (raw as Campaign);
    } catch {
      // пропускаємо биті записи
      continue;
    }
    if (isDeletedCampaign(c)) continue;

    const v1 = normVariant(c?.rules?.v1?.value);
    const v2 = normVariant(c?.rules?.v2?.value);

    if (v1) taken.set(v1, { campaignId: c!.id, campaignName: c?.name, which: "v1" });
    if (v2) taken.set(v2, { campaignId: c!.id, campaignName: c?.name, which: "v2" });
  }

  const conflicts: UniquenessResult extends { ok: false; conflicts: infer X } ? X : never = [] as any;

  if (wantV1 && taken.has(wantV1)) {
    const t = taken.get(wantV1)!;
    conflicts.push({ which: "v1", value: wantV1, campaignId: t.campaignId, campaignName: t.campaignName });
  }
  if (wantV2 && taken.has(wantV2)) {
    const t = taken.get(wantV2)!;
    conflicts.push({ which: "v2", value: wantV2, campaignId: t.campaignId, campaignName: t.campaignName });
  }

  if (conflicts.length) return { ok: false, conflicts };
  return { ok: true };
}

/** Зручний варіант: кинути 409, якщо конфлікт */
export async function assertVariantsUniqueOrThrow(params: {
  v1?: VariantRule;
  v2?: VariantRule;
  excludeId?: string | number;
}) {
  const res = await checkVariantUniqueness(params);
  if (res.ok) return;

  const msg =
    "Variant values must be unique across campaigns. Conflicts: " +
    res.conflicts
      .map(
        (c) =>
          `[${c.which}] "${c.value}" already used in campaign ${c.campaignId}${
            c.campaignName ? ` (${c.campaignName})` : ""
          }`
      )
      .join("; ");

  const err = new Error(msg) as Error & { status?: number; conflicts?: UniquenessResult["conflicts"] };
  err.status = 409;
  err.conflicts = res.conflicts;
  throw err;
}
