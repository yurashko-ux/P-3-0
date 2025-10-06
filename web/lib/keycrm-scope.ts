// web/lib/keycrm-scope.ts
import { findCardSimple } from "@/lib/keycrm-find";

const BASE = (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(/\/$/, "");
const TOKEN = process.env.KEYCRM_API_TOKEN || "";

function kcUrl(path: string) {
  return `${BASE}/${path.replace(/^\//, "")}`;
}

type SearchStrategy = "social" | "title" | "both";
type TitleMode = "exact" | "contains";

type FindInScopeArgs = {
  username?: string;
  fullNames?: string[];
  pipeline_id: number;
  status_id: number;
  max_pages?: number;
};

type AttemptLog = {
  username?: string | null;
  full_name?: string | null;
  strategy: SearchStrategy;
  title_mode: TitleMode;
  checked: number;
  pages: number;
  ok: boolean;
  card_id: number | null;
};

type FindInScopeResult = {
  cardId: number | null;
  checked: number;
  pages: number;
  attempts: AttemptLog[];
  raw?: unknown;
};

const norm = (s?: string | null) => (s || "").trim();

function uniqueStrings(values?: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values || []) {
    const n = norm(v);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

async function runAttempt(
  baseArgs: {
    pipeline_id: number;
    status_id: number;
    max_pages: number;
  },
  attempt: {
    username?: string;
    full_name?: string;
    strategy: SearchStrategy;
    title_mode: TitleMode;
  }
) {
  const res = await findCardSimple({
    scope: "campaign",
    pipeline_id: baseArgs.pipeline_id,
    status_id: baseArgs.status_id,
    max_pages: baseArgs.max_pages,
    username: attempt.username,
    full_name: attempt.full_name,
    strategy: attempt.strategy,
    title_mode: attempt.title_mode,
  });

  const checked = typeof res?.stats?.checked === "number" ? res.stats.checked : 0;
  const pages = typeof res?.used?.pages_scanned === "number" ? res.used.pages_scanned : 0;
  const cardId = res?.ok && res?.result?.id ? Number(res.result.id) : null;

  const log: AttemptLog = {
    username: attempt.username || null,
    full_name: attempt.full_name || null,
    strategy: attempt.strategy,
    title_mode: attempt.title_mode,
    checked,
    pages,
    ok: Boolean(res?.ok),
    card_id: cardId,
  };

  return { res, cardId, checked, pages, log };
}

export async function kcFindCardIdInScope(args: FindInScopeArgs): Promise<FindInScopeResult> {
  const username = norm(args.username);
  const fullNames = uniqueStrings(args.fullNames);
  const base = {
    pipeline_id: args.pipeline_id,
    status_id: args.status_id,
    max_pages: Math.max(1, args.max_pages ?? 3),
  };

  const attempts: AttemptLog[] = [];
  let totalChecked = 0;
  let totalPages = 0;
  let found: number | null = null;
  let raw: unknown = null;

  const tryAttempt = async (
    strategy: SearchStrategy,
    title_mode: TitleMode,
    full_name?: string
  ) => {
    if (found) return;
    const { res, cardId, checked, pages, log } = await runAttempt(base, {
      username: username || undefined,
      full_name,
      strategy,
      title_mode,
    });
    attempts.push(log);
    totalChecked += checked;
    totalPages = Math.max(totalPages, pages);
    if (!raw) raw = res;
    if (cardId) {
      found = cardId;
    }
  };

  if (username || fullNames.length) {
    await tryAttempt(
      fullNames.length && username ? "both" : username ? "social" : "title",
      "exact",
      fullNames[0]
    );
  }

  if (!found && username) {
    await tryAttempt("social", "exact");
  }

  if (!found) {
    for (const name of fullNames) {
      await tryAttempt("title", "exact", name);
      if (found) break;
    }
  }

  if (!found && fullNames.length) {
    for (const name of fullNames) {
      await tryAttempt("title", "contains", name);
      if (found) break;
    }
  }

  return {
    cardId: found,
    checked: totalChecked,
    pages: totalPages,
    attempts,
    raw,
  };
}

export async function kcMoveCard(
  cardId: number,
  pipelineId: number,
  statusId: number
): Promise<{ ok: boolean; status: number; json: any }> {
  if (!TOKEN) {
    return { ok: false, status: 401, json: { error: "missing_keycrm_token" } };
  }

  const url = kcUrl(`/pipelines/cards/${cardId}/move`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ pipeline_id: pipelineId, status_id: statusId }),
  });

  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}
