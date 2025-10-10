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

function toArray(value: unknown): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      return obj.data;
    }
    if (Array.isArray(obj.items)) {
      return obj.items;
    }
    if (Array.isArray(obj.list)) {
      return obj.list;
    }
    return Object.values(obj);
  }
  return [];
}

function normalizePipeline(raw: any): KeycrmPipeline | null {
  const id = toNumber(raw?.id);
  if (id === null) {
    return null;
  }

  const statusesRaw: any[] = [
    ...toArray(raw?.statuses),
    ...toArray(raw?.pipeline_statuses),
    ...toArray(raw?.statuses?.data),
    ...toArray(raw?.statuses?.items),
    ...toArray(raw?.statuses?.list),
  ];

  const seenStatusIds = new Set<number>();

  const statuses: KeycrmPipelineStatus[] = statusesRaw
    .map((status) => {
      const statusId = toNumber(status?.id);
      if (statusId === null) {
        return null;
      }
      if (seenStatusIds.has(statusId)) {
        return null;
      }
      seenStatusIds.add(statusId);
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

    let pipelines = list
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

    const pipelinesMissingStatuses = pipelines.filter((pipeline) => pipeline.statuses.length === 0);

    if (pipelinesMissingStatuses.length) {
      const updates = new Map<number, KeycrmPipelineStatus[]>();

      for (const pipeline of pipelinesMissingStatuses) {
        try {
          const detailRes = await fetch(keycrmUrl(`/pipelines/${pipeline.id}?with[]=statuses`), {
            headers: keycrmHeaders(),
            cache: "no-store",
          });

          if (!detailRes.ok) {
            continue;
          }

          const detailJson = await detailRes.json().catch(() => null);
          const normalized = normalizePipeline(detailJson?.data ?? detailJson ?? {});
          if (normalized && normalized.statuses.length) {
            updates.set(pipeline.id, normalized.statuses);
          }
        } catch (detailErr) {
          console.warn("Failed to load KeyCRM pipeline statuses", {
            pipelineId: pipeline.id,
            error: formatError(detailErr),
          });
        }
      }

      if (updates.size) {
        pipelines = pipelines.map((pipeline) => {
          const updatedStatuses = updates.get(pipeline.id);
          if (!updatedStatuses || !updatedStatuses.length) {
            return pipeline;
          }
          return { ...pipeline, statuses: updatedStatuses };
        });
      }
    }

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
