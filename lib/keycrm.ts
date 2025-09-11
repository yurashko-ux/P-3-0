// lib/keycrm.ts
// KeyCRM HTTP adapter + KV-based search shims (backward compatible)
// Fixes:
//  - no dependency on kvZRevRange (use kvZRange + reverse)
//  - findCardIdByUsername accepts string OR object args
//  - kcFindCardIdByAny pipeline/status are optional

import { kvGet, kvZRange } from "@/lib/kv";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const BASE_URL = process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1";
const TOKEN = process.env.KEYCRM_API_TOKEN || "";

if (!TOKEN) {
  console.warn("[keycrm] Missing KEYCRM_API_TOKEN");
}

/* -------------------------- HTTP helpers -------------------------- */

function qs(params: Record<string, any> = {}): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function keycrmFetch<T = any>(
  path: string,
  {
    method = "GET",
    query,
    body,
    timeoutMs = 10_000,
  }: {
    method?: HttpMethod;
    query?: Record<string, any>;
    body?: any;
    timeoutMs?: number;
  } = {},
): Promise<{ ok: boolean; status: number; data: T | null; error?: any }> {
  const url = `${BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}${qs(query)}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(id);

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text || null;
    }

    if (!res.ok) return { ok: false, status: res.status, data, error: data };
    return { ok: true, status: res.status, data };
  } catch (err) {
    clearTimeout(id);
    return { ok: false, status: 0, data: null, error: err };
  }
}

/* -------------------------- Public HTTP API -------------------------- */

export async function kcGetPipelines() {
  return keycrmFetch<any[]>("/pipelines");
}

export async function kcGetStatuses(pipelineId: string | number) {
  const a = await keycrmFetch<any[]>(`/pipelines/${pipelineId}/statuses`);
  if (a.ok) return a;
  return keycrmFetch<any[]>("/pipelines/statuses", { query: { pipeline_id: pipelineId } });
}

export interface ListCardsParams {
  pipeline_id: string | number;
  status_id: string | number;
  page?: number;
  per_page?: number;
}

/**
 * GET /pipelines/cards?page=&per_page=&pipeline_id=&status_id=
 * Returns Laravel-like pagination: { total, current_page, per_page, data, last_page?, meta? }
 */
export async function kcListCardsLaravel(params: ListCardsParams) {
  const { pipeline_id, status_id, page = 1, per_page = 50 } = params;
  return keycrmFetch<any>("/pipelines/cards", {
    method: "GET",
    query: { pipeline_id, status_id, page, per_page },
  });
}

/**
 * PUT /pipelines/cards/{cardId} with { pipeline_id?, status_id? }
 */
export async function kcMoveCard(
  cardId: string | number,
  to_pipeline_id?: string | number | null,
  to_status_id?: string | number | null,
) {
  const body: Record<string, any> = {};
  if (to_pipeline_id != null && to_pipeline_id !== "") body.pipeline_id = Number(to_pipeline_id);
  if (to_status_id != null && to_status_id !== "") body.status_id = Number(to_status_id);
  if (Object.keys(body).length === 0) return { ok: true, status: 200, data: { noop: true } };
  return keycrmFetch(`/pipelines/cards/${cardId}`, { method: "PUT", body });
}

/* -------------------------- Normalization -------------------------- */

export type NormalizedCard = {
  id: number;
  title: string;
  pipeline_id: number | null;
  status_id: number | null;
  contact_social_name: string | null;
  contact_social_id: string | null;
  contact_full_name: string | null;
  updated_at: string; // 'YYYY-MM-DD HH:mm:ss' or ISO-ish
};

export function normalizeCard(raw: any): NormalizedCard {
  const pipelineId = raw?.status?.pipeline_id ?? raw?.pipeline_id ?? null;
  const statusId = raw?.status_id ?? raw?.status?.id ?? null;
  const socialName = String(raw?.contact?.social_name ?? "").toLowerCase() || null;
  const socialId = raw?.contact?.social_id ?? null;
  const fullName = raw?.contact?.full_name ?? raw?.contact?.client?.full_name ?? null;

  return {
    id: Number(raw?.id),
    title: String(raw?.title ?? "").trim(),
    pipeline_id: pipelineId != null ? Number(pipelineId) : null,
    status_id: statusId != null ? Number(statusId) : null,
    contact_social_name: socialName,
    contact_social_id: socialId,
    contact_full_name: fullName ?? null,
    updated_at: String(raw?.updated_at ?? raw?.status_changed_at ?? new Date().toISOString()),
  };
}

export function toEpoch(x?: string | number | Date | null): number {
  if (x instanceof Date) return x.getTime();
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const t = Date.parse(x);
    return Number.isFinite(t) ? t : Date.now();
  }
  return Date.now();
}

/* -------------------------- KV search shims -------------------------- */

// emulate ZREVRANGE using kvZRange + reverse (for compatibility)
async function zRevRange(key: string, start: number, stop: number): Promise<any[]> {
  // read full range then slice reversed; acceptable for small N (we use ≤200)
  const arr = (await kvZRange(key, 0, -1)) as any;
  const members = extractMembers(arr).reverse();
  // normalize stop as inclusive index per Redis semantics
  const end = stop < 0 ? members.length + stop + 1 : stop + 1;
  return members.slice(start, end).map((member) => ({ member }));
}

function normHandle(raw?: string | null): string | null {
  if (!raw) return null;
  return String(raw).trim().replace(/^@/, "").toLowerCase();
}

function includesCI(h?: string | null, n?: string | null): boolean {
  if (!h || !n) return false;
  return h.toLowerCase().includes(n.toLowerCase());
}

// kvZRange may return string[] or { member: string; score?: number }[]
function extractMembers(arr: any): string[] {
  if (!arr) return [];
  if (Array.isArray(arr)) {
    return arr.map((x: any) => (typeof x === "string" ? x : x?.member)).filter(Boolean);
  }
  return [];
}

type KvCard = {
  id: number;
  title?: string | null;
  pipeline_id?: number | null;
  status_id?: number | null;
  contact_social_name?: string | null;
  contact_social_id?: string | null;
  contact_full_name?: string | null;
  updated_at?: string | null;
};

async function getKvCard(id: string): Promise<KvCard | null> {
  const raw = await kvGet(`kc:card:${id}`);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? (JSON.parse(raw) as KvCard) : (raw as KvCard);
  } catch {
    return null;
  }
}

function inBasePair(card: KvCard, p?: string, s?: string): boolean {
  if (!p || !s) return true; // if no filter provided, accept any
  const cp = card.pipeline_id != null ? String(card.pipeline_id) : "";
  const cs = card.status_id != null ? String(card.status_id) : "";
  return cp === p && cs === s;
}

/**
 * findCardIdByUsername
 * Back-compat signature:
 *  - findCardIdByUsername("handle")
 *  - findCardIdByUsername({ username, pipeline_id?, status_id?, limit? })
 * Searches social indexes kc:index:social:instagram:{handle} and @{handle}.
 * If pipeline/status provided — filters within the base pair; otherwise returns newest overall.
 */
export async function findCardIdByUsername(
  arg:
    | string
    | {
        username: string;
        pipeline_id?: string | number;
        status_id?: string | number;
        limit?: number;
      },
): Promise<string | null> {
  const username = typeof arg === "string" ? arg : arg.username;
  const p = typeof arg === "string" ? undefined : arg.pipeline_id != null ? String(arg.pipeline_id) : undefined;
  const s = typeof arg === "string" ? undefined : arg.status_id != null ? String(arg.status_id) : undefined;
  const limit = typeof arg === "string" ? 50 : arg.limit ?? 50;

  const h = normHandle(username);
  if (!h) return null;

  const keyA = `kc:index:social:instagram:${h}`;
  const keyB = `kc:index:social:instagram:@${h}`;

  const a = await zRevRange(keyA, 0, Math.max(1, limit) - 1);
  const b = await zRevRange(keyB, 0, Math.max(1, limit) - 1);
  const mergedIds = [...new Set([...a, ...b].map((x: any) => x.member).filter(Boolean))];

  let best: { id: string; score: number } | null = null;
  for (const id of mergedIds) {
    const card = await getKvCard(id);
    if (!card) continue;
    if (!inBasePair(card, p, s)) continue;
    const score = toEpoch(card.updated_at);
    if (!best || score > best.score) best = { id, score };
  }
  return best?.id ?? null;
}

/**
 * kcFindCardIdByAny
 * 1) try by username (IG social index)
 * 2) fallback scan of kc:index:cards:{p}:{s} (or all pairs if none provided)
 *    matching by title or contact_full_name (case-insensitive)
 */
export async function kcFindCardIdByAny(args: {
  username?: string | null;
  full_name?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  pipeline_id?: string | number; // optional for back-compat
  status_id?: string | number;   // optional for back-compat
  limit?: number; // fallback scan depth per pair (default 200)
}): Promise<string | null> {
  const {
    username,
    full_name,
    name,
    first_name,
    last_name,
    pipeline_id,
    status_id,
    limit = 200,
  } = args;

  // 1) by username (IG)
  if (username) {
    const byUser = await findCardIdByUsername({
      username,
      pipeline_id,
      status_id,
      limit: 50,
    });
    if (byUser) return byUser;
  }

  // candidates for fullname
  const candidates = new Set<string>();
  if (full_name) candidates.add(String(full_name).trim());
  if (name) candidates.add(String(name).trim());
  if (first_name || last_name) candidates.add(`${first_name ?? ""} ${last_name ?? ""}`.trim());
  for (const v of [...candidates]) if (!v) candidates.delete(v);
  if (candidates.size === 0) return null;

  // build list of card-index keys to scan
  const keysToScan: string[] = [];
  if (pipeline_id != null && status_id != null) {
    keysToScan.push(`kc:index:cards:${String(pipeline_id)}:${String(status_id)}`);
  } else {
    // back-compat: if no base pair provided, scan *all* card indexes found under a small heuristic set
    // (in production, it's recommended to pass pipeline/status to avoid wide scans)
    // For compatibility, try a few common pipeline/status ranges (lightweight best-effort).
    for (let p = 1; p <= 5; p++) {
      for (let s = 1; s <= 10; s++) {
        keysToScan.push(`kc:index:cards:${p}:${s}`);
      }
    }
  }

  for (const cardsKey of keysToScan) {
    const idsRaw = await zRevRange(cardsKey, 0, Math.max(1, limit) - 1);
    const ids = idsRaw.map((x: any) => x.member).filter(Boolean);

    for (const id of ids) {
      const card = await getKvCard(id);
      if (!card) continue;

      // if a base pair filter is provided, enforce it here too
      if (pipeline_id != null && status_id != null && !inBasePair(card, String(pipeline_id), String(status_id))) {
        continue;
      }

      const title = card.title ?? "";
      const cfn = card.contact_full_name ?? "";

      let match = false;
      for (const q of candidates) {
        if (
          includesCI(title, q) ||
          includesCI(cfn, q) ||
          includesCI(title, `Чат з ${q}`)
        ) {
          match = true;
          break;
        }
      }
      if (match) return String(card.id);
    }
  }

  return null;
}
