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

export type KeycrmPipelineDetailSuccess = {
  ok: true;
  pipeline: KeycrmPipeline;
  fetchedAt: string;
  source: "remote" | "cache";
};

export type KeycrmPipelineDetailError = {
  ok: false;
  error: string;
  details?: unknown;
  pipeline: KeycrmPipeline | null;
  fetchedAt: string | null;
};

export type KeycrmPipelineDetailResult =
  | KeycrmPipelineDetailSuccess
  | KeycrmPipelineDetailError;

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

type PipelineDetailCacheEntry = {
  pipeline: KeycrmPipeline;
  fetchedAt: string;
  expiresAt: number;
  source: "remote" | "cache";
};

const detailCache = new Map<number, PipelineDetailCacheEntry>();

async function fetchPipelineStatusesOnly(pipelineId: number): Promise<KeycrmPipelineStatus[]> {
  const attempts: { url: string; kind: "pipeline" | "statuses" }[] = [
    { url: `/pipelines/${pipelineId}?with[]=statuses`, kind: "pipeline" },
    { url: `/pipelines/${pipelineId}/statuses`, kind: "statuses" },
    { url: `/pipeline-statuses?pipeline_id=${pipelineId}&per_page=100`, kind: "statuses" },
    { url: `/statuses?pipeline_id=${pipelineId}&per_page=100`, kind: "statuses" },
  ];

  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      const res = await fetch(keycrmUrl(attempt.url), {
        headers: keycrmHeaders(),
        cache: "no-store",
      });

      if (res.status === 404) {
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const error = body ? `${res.status} ${res.statusText}: ${body}` : `${res.status} ${res.statusText}`;
        throw new Error(`KeyCRM statuses request failed: ${error}`);
      }

      const json = await res.json().catch(() => null);

      if (attempt.kind === "pipeline") {
        const normalized = normalizePipeline(json?.data ?? json ?? {});
        if (normalized?.statuses.length) {
          return normalized.statuses;
        }
        continue;
      }

      const normalized = normalizePipeline({ id: pipelineId, statuses: json ?? [] });
      if (normalized?.statuses.length) {
        return normalized.statuses;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

function rememberPipeline(
  pipeline: KeycrmPipeline,
  options: { fetchedAt: string; expiresAt: number; source: "remote" | "cache" }
) {
  detailCache.set(pipeline.id, {
    pipeline,
    fetchedAt: options.fetchedAt,
    expiresAt: options.expiresAt,
    source: options.source,
  });

  if (!cache) {
    cache = {
      data: [pipeline],
      fetchedAt: options.fetchedAt,
      expiresAt: options.expiresAt,
    };
    return;
  }

  const index = cache.data.findIndex((item) => item.id === pipeline.id);
  const data = index === -1 ? [...cache.data, pipeline] : cache.data.map((item, i) => (i === index ? pipeline : item));

  cache = {
    data: data.sort((a, b) => {
      const posA = a.position ?? Number.MAX_SAFE_INTEGER;
      const posB = b.position ?? Number.MAX_SAFE_INTEGER;
      if (posA === posB) {
        return a.id - b.id;
      }
      return posA - posB;
    }),
    fetchedAt: options.fetchedAt,
    expiresAt: options.expiresAt,
  };
}

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
          const statuses = await fetchPipelineStatusesOnly(pipeline.id);
          if (statuses.length) {
            updates.set(pipeline.id, statuses);
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

    const expiresAt = now + CACHE_TTL_MS;

    cache = {
      data: pipelines,
      fetchedAt,
      expiresAt,
    };

    for (const pipeline of pipelines) {
      if (pipeline.statuses.length) {
        rememberPipeline(pipeline, { fetchedAt, expiresAt, source: "remote" });
      }
    }

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

export async function fetchKeycrmPipelineDetail(
  pipelineId: number,
  options: { forceRefresh?: boolean } = {}
): Promise<KeycrmPipelineDetailResult> {
  const now = Date.now();

  const cached = detailCache.get(pipelineId);
  if (!options.forceRefresh && cached && cached.expiresAt > now) {
    return { ok: true, pipeline: cached.pipeline, fetchedAt: cached.fetchedAt, source: cached.source };
  }

  if (!options.forceRefresh && cache) {
    const fromCache = cache.data.find((pipeline) => pipeline.id === pipelineId);
    if (fromCache && fromCache.statuses.length) {
      const entry = {
        pipeline: fromCache,
        fetchedAt: cache.fetchedAt,
        expiresAt: cache.expiresAt,
        source: "cache" as const,
      };
      detailCache.set(pipelineId, entry);
      return { ok: true, pipeline: entry.pipeline, fetchedAt: entry.fetchedAt, source: entry.source };
    }
  }

  try {
    assertKeycrmEnv();
  } catch (err) {
    if (cached) {
      return {
        ok: false,
        error: "keycrm_env_missing",
        details: formatError(err),
        pipeline: cached.pipeline,
        fetchedAt: cached.fetchedAt,
      };
    }

    return {
      ok: false,
      error: "keycrm_env_missing",
      details: formatError(err),
      pipeline: null,
      fetchedAt: null,
    };
  }

  let fetchedAt: string | null = null;
  let basePipeline: KeycrmPipeline | null = null;

  if (cached) {
    basePipeline = cached.pipeline;
    fetchedAt = cached.fetchedAt;
  } else if (cache) {
    const fromCache = cache.data.find((pipeline) => pipeline.id === pipelineId) ?? null;
    if (fromCache) {
      basePipeline = fromCache;
      fetchedAt = cache.fetchedAt;
    }
  }

  let remotePipeline: KeycrmPipeline | null = null;
  let statuses: KeycrmPipelineStatus[] = [];

  try {
    const qs = new URLSearchParams();
    qs.append("with[]", "statuses");

    const res = await fetch(keycrmUrl(`/pipelines/${pipelineId}?${qs.toString()}`), {
      headers: keycrmHeaders(),
      cache: "no-store",
    });

    if (res.status === 404) {
      // fall through to statuses-only fetches using cached pipeline meta
    } else if (!res.ok) {
      const body = await res.text().catch(() => "");
      const error = body ? `${res.status} ${res.statusText}: ${body}` : `${res.status} ${res.statusText}`;
      throw new Error(`KeyCRM pipeline request failed: ${error}`);
    } else {
      const json = await res.json().catch(() => null);
      const normalized = normalizePipeline(json?.data ?? json ?? {});
      if (normalized) {
        remotePipeline = normalized;
        statuses = normalized.statuses;
      }
    }
  } catch (err) {
    console.warn("Failed to load KeyCRM pipeline detail", {
      pipelineId,
      error: formatError(err),
    });
  }

  if (!remotePipeline && basePipeline) {
    remotePipeline = { ...basePipeline };
  }

  if (remotePipeline && remotePipeline.statuses.length && statuses.length === 0) {
    statuses = remotePipeline.statuses;
  }

  if (statuses.length === 0) {
    try {
      statuses = await fetchPipelineStatusesOnly(pipelineId);
    } catch (statusErr) {
      console.warn("Failed to load KeyCRM pipeline statuses via fallbacks", {
        pipelineId,
        error: formatError(statusErr),
      });
    }
  }

  if (!remotePipeline && statuses.length) {
    remotePipeline =
      basePipeline ?? {
        id: pipelineId,
        title: `Воронка #${pipelineId}`,
        color: null,
        isDefault: null,
        position: null,
        statuses: [],
      };
  }

  if (remotePipeline) {
    const hydrated: KeycrmPipeline = {
      ...remotePipeline,
      statuses,
    };

    const resolvedFetchedAt = new Date().toISOString();
    const expiresAt = now + CACHE_TTL_MS;

    rememberPipeline(hydrated, { fetchedAt: resolvedFetchedAt, expiresAt, source: "remote" });

    return { ok: true, pipeline: hydrated, fetchedAt: resolvedFetchedAt, source: "remote" };
  }

  return {
    ok: false,
    error: "keycrm_pipeline_not_found",
    pipeline: basePipeline,
    fetchedAt,
  };
}
