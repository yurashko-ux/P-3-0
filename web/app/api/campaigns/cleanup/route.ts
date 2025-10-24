// web/app/api/campaigns/cleanup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { campaignKeys, getKvConfigStatus } from "@/lib/kv";
import { unwrapDeep } from "@/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEGACY_COLLECTION_KEYS = [
  "cmp:list:items",
  "cmp:list:ids:RO",
  "cmp:list:ids:WR",
  "campaigns",
];

const INDEX_KEYS = [
  campaignKeys.CMP_INDEX_KEY,
  campaignKeys.INDEX_KEY,
  campaignKeys.LEGACY_INDEX_KEY,
  ...LEGACY_COLLECTION_KEYS,
];

function unauthorised() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pushId(target: Set<string>, value: unknown) {
  const unwrapped = unwrapDeep(value);
  if (isString(unwrapped)) {
    const trimmed = unwrapped.trim();
    if (trimmed && trimmed !== "[object Object]") {
      target.add(trimmed);
    }
    return;
  }
  if (isNumber(unwrapped)) {
    target.add(String(unwrapped));
    return;
  }
  if (unwrapped && typeof unwrapped === "object") {
    const anyObject = unwrapped as Record<string, unknown>;
    if (anyObject.id !== undefined) {
      pushId(target, anyObject.id);
    } else if (anyObject.value !== undefined) {
      pushId(target, anyObject.value);
    } else if (anyObject.__index_id !== undefined) {
      pushId(target, anyObject.__index_id);
    }
  }
}

function collectIds(value: unknown, target: Set<string>, depth = 0) {
  if (value == null || depth > 5) return;
  const unwrapped = unwrapDeep(value);
  if (Array.isArray(unwrapped)) {
    for (const entry of unwrapped) {
      collectIds(entry, target, depth + 1);
    }
    return;
  }

  pushId(target, unwrapped);

  if (unwrapped && typeof unwrapped === "object") {
    const obj = unwrapped as Record<string, unknown>;
    if (Array.isArray(obj.items)) {
      collectIds(obj.items, target, depth + 1);
    }
    for (const key of ["base", "t1", "t2", "texp"]) {
      if (obj[key] && typeof obj[key] === "object") {
        const nested = obj[key] as Record<string, unknown>;
        if (nested.pipeline_id !== undefined) pushId(target, nested.pipeline_id);
        if (nested.status_id !== undefined) pushId(target, nested.status_id);
        if (nested.pipeline !== undefined) pushId(target, nested.pipeline);
        if (nested.status !== undefined) pushId(target, nested.status);
      }
    }
    for (const value of Object.values(obj)) {
      if (typeof value === "string" || typeof value === "number") {
        pushId(target, value);
      } else if (value && typeof value === "object") {
        collectIds(value, target, depth + 1);
      }
    }
  }
}

type GatherResult = {
  ids: string[];
  sources: Record<string, number>;
  kvDisabled?: boolean;
};

async function gatherCampaignIds(kvReadable: boolean): Promise<GatherResult> {
  if (!kvReadable) {
    return { ids: [], sources: {}, kvDisabled: true };
  }

  const ids = new Set<string>();
  const sources: Record<string, number> = {};

  const register = (label: string, value: unknown) => {
    const before = ids.size;
    collectIds(value, ids);
    const diff = ids.size - before;
    if (diff > 0) {
      sources[label] = diff;
    }
  };

  const safeGet = async <T,>(key: string): Promise<T | null> => {
    try {
      return (await kv.get<T | null>(key)) ?? null;
    } catch (error) {
      console.warn(`[campaigns:cleanup] kv.get(${key}) failed`, error);
      return null;
    }
  };

  const safeList = async (key: string): Promise<(string | number)[]> => {
    try {
      const value = await kv.lrange<string | number>(key, 0, -1);
      return Array.isArray(value) ? value : [];
    } catch (error) {
      console.warn(`[campaigns:cleanup] kv.lrange(${key}) failed`, error);
      return [];
    }
  };

  const cmpIndex = unwrapDeep(await safeGet(campaignKeys.CMP_INDEX_KEY));
  register(campaignKeys.CMP_INDEX_KEY, cmpIndex);

  const cmpList = await safeList(campaignKeys.CMP_INDEX_KEY);
  register(`${campaignKeys.CMP_INDEX_KEY}:list`, cmpList);

  const campaignIndex = unwrapDeep(await safeGet(campaignKeys.INDEX_KEY));
  register(campaignKeys.INDEX_KEY, campaignIndex);

  const legacyIndex = unwrapDeep(await safeGet(campaignKeys.LEGACY_INDEX_KEY));
  register(campaignKeys.LEGACY_INDEX_KEY, legacyIndex);

  for (const key of LEGACY_COLLECTION_KEYS) {
    const value = unwrapDeep(await safeGet(key));
    register(key, value);
  }

  return { ids: Array.from(ids).filter(Boolean), sources };
}

async function deleteKeys(keys: string[], kvWritable: boolean): Promise<number> {
  if (!kvWritable) return 0;
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  const chunkSize = 50;
  let deleted = 0;

  for (let i = 0; i < uniqueKeys.length; i += chunkSize) {
    const slice = uniqueKeys.slice(i, i + chunkSize);
    if (!slice.length) continue;
    await kv.del(...slice);
    deleted += slice.length;
  }

  return deleted;
}

function resetMemoryCaches() {
  const globalAny = globalThis as typeof globalThis & {
    __campaignMemoryStore?: { ids: string[]; items: Record<string, unknown> };
    __campaignKvState?: { disabled: boolean; error: Error | null };
  };

  if (globalAny.__campaignMemoryStore) {
    globalAny.__campaignMemoryStore.ids = [];
    globalAny.__campaignMemoryStore.items = Object.create(null);
  }

  if (globalAny.__campaignKvState) {
    globalAny.__campaignKvState.disabled = false;
    globalAny.__campaignKvState.error = null;
  }
}

function buildErrorResponse(error: unknown, status = 500) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown_error";
  const stack = error instanceof Error ? error.stack : undefined;

  return NextResponse.json(
    {
      ok: false,
      error: "kv_cleanup_failed",
      message,
      ...(stack ? { stack } : {}),
    },
    { status },
  );
}

export async function POST(req: NextRequest) {
  const adminPass = process.env.ADMIN_PASS || "";
  const kvStatus = getKvConfigStatus();
  const kvReadable = kvStatus.hasBaseUrl && (kvStatus.hasReadToken || kvStatus.hasWriteToken);
  const kvWritable = kvStatus.hasBaseUrl && kvStatus.hasWriteToken;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const providedToken =
    (typeof body?.token === "string" ? body.token : null) ||
    req.headers.get("x-admin-pass") ||
    req.cookies.get("admin_token")?.value ||
    "";

  if (adminPass && providedToken !== adminPass) {
    return unauthorised();
  }

  if (!body?.confirm) {
    return NextResponse.json(
      { ok: false, error: "confirmation_required" },
      { status: 400 },
    );
  }

  try {
    const { ids, sources, kvDisabled } = await gatherCampaignIds(kvReadable);

    const itemKeys: string[] = [];
    for (const id of ids) {
      itemKeys.push(
        campaignKeys.CMP_ITEM_KEY(id),
        campaignKeys.ITEM_KEY(id),
        campaignKeys.LEGACY_ITEM_KEY(id),
      );
    }

    const indexDeletion = await deleteKeys([...itemKeys, ...INDEX_KEYS], kvWritable);

    resetMemoryCaches();

    return NextResponse.json({
      ok: true,
      deletedIds: ids.length,
      deletedKeys: indexDeletion,
      sampleIds: ids.slice(0, 10),
      sources,
      kvDisabled: Boolean(kvDisabled || !kvWritable),
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}

export async function GET(req: NextRequest) {
  const adminPass = process.env.ADMIN_PASS || "";
  const cookieToken = req.cookies.get("admin_token")?.value || "";
  const headerToken = req.headers.get("x-admin-pass") || "";
  const kvStatus = getKvConfigStatus();
  const kvReadable = kvStatus.hasBaseUrl && (kvStatus.hasReadToken || kvStatus.hasWriteToken);

  if (adminPass && cookieToken !== adminPass && headerToken !== adminPass) {
    return unauthorised();
  }

  try {
    const { ids, sources, kvDisabled } = await gatherCampaignIds(kvReadable);

    return NextResponse.json({
      ok: true,
      totalIds: ids.length,
      sampleIds: ids.slice(0, 10),
      sources,
      kvDisabled: Boolean(kvDisabled || !kvReadable),
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}
