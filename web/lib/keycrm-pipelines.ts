// web/lib/keycrm-pipelines.ts
import { assertKeycrmEnv, keycrmHeaders, keycrmUrl } from "@/lib/env";

export type KeycrmPipelineStatus = {
  id: number;
  title: string;
  pipelineId: number | null;
  color: string | null;
  isFinal: boolean | null;
  position: number | null;
};

export type KeycrmPipeline = {
  id: number;
  title: string;
  color: string | null;
  isDefault: boolean | null;
  position: number | null;
  statuses: KeycrmPipelineStatus[];
};

export type KeycrmPipelineListSuccess = {
  ok: true;
  pipelines: KeycrmPipeline[];
  fetchedAt: string;
  source: "remote" | "cache";
};

export type KeycrmPipelineListError = {
  ok: false;
  error: string;
  details?: unknown;
  pipelines: KeycrmPipeline[];
  fetchedAt: string | null;
  source: "stale" | "none";
};

export type KeycrmPipelineListResult = KeycrmPipelineListSuccess | KeycrmPipelineListError;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 хвилин кешу достатньо для вибору у віджеті

type PipelineCache = {
  data: KeycrmPipeline[];
  fetchedAt: string;
  expiresAt: number;
};

let cache: PipelineCache | null = null;

function toNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizePipeline(raw: any): KeycrmPipeline | null {
  const id = toNumber(raw?.id);
  if (id === null) {
    return null;
  }

  const statusesRaw: any[] = Array.isArray(raw?.statuses)
    ? raw.statuses
    : Array.isArray(raw?.pipeline_statuses)
      ? raw.pipeline_statuses
      : [];

  const statuses: KeycrmPipelineStatus[] = statusesRaw
    .map((status) => {
      const statusId = toNumber(status?.id);
      if (statusId === null) {
        return null;
      }
      return {
        id: statusId,
        title: String(status?.title ?? status?.name ?? `Статус #${statusId}`),
        pipelineId: toNumber(status?.pipeline_id ?? raw?.id),
        color: status?.color ? String(status.color) : null,
        isFinal: typeof status?.is_final === "boolean" ? status.is_final : null,
        position: toNumber(status?.position),
      };
    })
    .filter((status): status is KeycrmPipelineStatus => status !== null)
    .sort((a, b) => {
      const posA = a.position ?? Number.MAX_SAFE_INTEGER;
      const posB = b.position ?? Number.MAX_SAFE_INTEGER;
      return posA - posB;
    });

  return {
    id,
    title: String(raw?.title ?? raw?.name ?? `Воронка #${id}`),
    color: raw?.color ? String(raw.color) : null,
    isDefault: typeof raw?.is_default === "boolean" ? raw.is_default : null,
    position: toNumber(raw?.position),
    statuses,
  };
}

function formatError(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export async function fetchKeycrmPipelines(
  options: { forceRefresh?: boolean } = {}
): Promise<KeycrmPipelineListResult> {
  const now = Date.now();

  if (!options.forceRefresh && cache && cache.expiresAt > now) {
    return { ok: true, pipelines: cache.data, fetchedAt: cache.fetchedAt, source: "cache" };
  }

  try {
    assertKeycrmEnv();
  } catch (err) {
    if (cache) {
      return {
        ok: false,
        error: "keycrm_env_missing",
        details: formatError(err),
        pipelines: cache.data,
        fetchedAt: cache.fetchedAt,
        source: "stale",
      };
    }

    return {
      ok: false,
      error: "keycrm_env_missing",
      details: formatError(err),
      pipelines: [],
      fetchedAt: null,
      source: "none",
    };
  }

  try {
    const qs = new URLSearchParams();
    qs.append("with[]", "statuses");
    qs.set("per_page", "100");

    const res = await fetch(keycrmUrl(`/pipelines?${qs.toString()}`), {
      headers: keycrmHeaders(),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const error = body ? `${res.status} ${res.statusText}: ${body}` : `${res.status} ${res.statusText}`;
      throw new Error(`KeyCRM pipelines request failed: ${error}`);
    }

    const json = await res.json().catch(() => null);
    const list: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
        ? json.data
        : [];

    const pipelines = list
      .map(normalizePipeline)
      .filter((pipeline): pipeline is KeycrmPipeline => pipeline !== null)
      .sort((a, b) => {
        const posA = a.position ?? Number.MAX_SAFE_INTEGER;
        const posB = b.position ?? Number.MAX_SAFE_INTEGER;
        if (posA === posB) {
          return a.id - b.id;
        }
        return posA - posB;
      });

    const fetchedAt = new Date().toISOString();

    cache = {
      data: pipelines,
      fetchedAt,
      expiresAt: now + CACHE_TTL_MS,
    };

    return { ok: true, pipelines, fetchedAt, source: "remote" };
  } catch (err) {
    if (cache) {
      return {
        ok: false,
        error: "keycrm_fetch_failed",
        details: formatError(err),
        pipelines: cache.data,
        fetchedAt: cache.fetchedAt,
        source: "stale",
      };
    }

    return {
      ok: false,
      error: "keycrm_fetch_failed",
      details: formatError(err),
      pipelines: [],
      fetchedAt: null,
      source: "none",
    };
  }
}
