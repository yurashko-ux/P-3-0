// web/app/api/campaigns/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { campaignKeys, kvRead, kvWrite } from "@/lib/kv";
import { normalizeId, uniqIds } from "@/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEGACY_INDEX_KEYS = ["cmp:ids", "cmp:list:items"] as const;
const LEGACY_ITEM_KEY = (id: string) => `cmp:item:${id}`;

const INDEX_KEYS = Array.from(
  new Set<string>([
    campaignKeys.INDEX_KEY,
    ...campaignKeys.ALT_INDEX_KEYS,
    ...LEGACY_INDEX_KEYS,
  ])
);

function buildItemKeys(id: string): string[] {
  const base = [campaignKeys.ITEM_KEY(id), ...campaignKeys.ALT_ITEM_KEYS.map((fn) => fn(id))];
  return Array.from(new Set([...base, LEGACY_ITEM_KEY(id)]));
}

function shouldDropFromIndex(entry: string, id: string, candidates: Set<string>): boolean {
  if (!entry) return false;
  const raw = entry.toString();
  if (candidates.has(raw)) return true;
  if (raw.endsWith(id) && (raw.startsWith("cmp:item:") || raw.startsWith("campaign:"))) {
    return true;
  }
  return normalizeId(raw) === id;
}

async function removeFromIndex(key: string, id: string, candidates: Set<string>) {
  const attempts = new Set<string>([...candidates]);
  attempts.add(id);
  attempts.add(`cmp:item:${id}`);
  attempts.add(`campaign:${id}`);

  for (const value of attempts) {
    // eslint-disable-next-line no-await-in-loop
    await kvWrite.lrem(key, value).catch(() => {});
  }

  const listed = await kvRead.lrange(key, 0, -1).catch(() => [] as string[]);
  const filtered = listed.filter((entry) => !shouldDropFromIndex(entry, id, attempts));
  if (filtered.length !== listed.length) {
    await kvWrite.del(key).catch(() => {});
    for (let i = filtered.length - 1; i >= 0; i -= 1) {
      // eslint-disable-next-line no-await-in-loop
      await kvWrite.lpush(key, filtered[i]).catch(() => {});
    }
  }

  const raw = await kvRead.getRaw(key).catch(() => null as string | null);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const arr = parsed.filter((entry) => !shouldDropFromIndex(String(entry), id, attempts));
      if (arr.length !== parsed.length) {
        await kvWrite.setRaw(key, JSON.stringify(arr));
      }
    }
  } catch {
    // ignore non-JSON payloads
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const idRaw = params?.id ?? "";
  const normalized = normalizeId(idRaw);
  if (!normalized) {
    return NextResponse.json({ ok: false, error: "no id" }, { status: 400 });
  }

  const candidates = new Set(uniqIds([idRaw, normalized]));

  let removed = false;
  const itemKeys = buildItemKeys(normalized);
  for (const key of itemKeys) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await kvWrite.del(key).catch(() => false);
    if (ok) {
      removed = true;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const raw = await kvRead.getRaw(key).catch(() => null as string | null);
    if (!raw || raw === "null" || raw === "undefined") continue;

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        (parsed as any).deleted = true;
        (parsed as any).active = false;
        removed = true;
        // eslint-disable-next-line no-await-in-loop
        await kvWrite.setRaw(key, JSON.stringify(parsed));
      }
    } catch {
      // ignore broken payloads
    }
  }

  // legacy list of embedded items might still exist
  const legacyRaw = await kvRead.getRaw("cmp:list:items").catch(() => null as string | null);
  if (legacyRaw) {
    try {
      const parsed = JSON.parse(legacyRaw);
      if (Array.isArray(parsed)) {
        let changed = false;
        const next = parsed.map((entry) => {
          if (!entry || typeof entry !== "object") return entry;
          const candidateId = normalizeId((entry as any).id ?? entry);
          if (!candidateId || candidateId !== normalized) return entry;
          changed = true;
          return { ...entry, deleted: true };
        });
        if (changed) {
          removed = true;
          await kvWrite.setRaw("cmp:list:items", JSON.stringify(next));
        }
      }
    } catch {
      // ignore broken payloads
    }
  }

  for (const key of INDEX_KEYS) {
    // eslint-disable-next-line no-await-in-loop
    await removeFromIndex(key, normalized, candidates);
  }

  if (!removed) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
