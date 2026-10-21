// Кеш джерел лідів (code → name/mark) для значка біля хмарки в Direct.
"use client";

import { useEffect, useState } from "react";

export type LeadSourceMeta = {
  code: string;
  name: string;
  mark: string | null;
  kind: string;
  hidden?: boolean;
};

type LeadSourcesMap = Record<string, LeadSourceMeta>;

let cachedMap: LeadSourcesMap | null = null;
let inflight: Promise<LeadSourcesMap> | null = null;

async function fetchLeadSourcesMap(): Promise<LeadSourcesMap> {
  const res = await fetch("/api/admin/direct/lead-sources", { cache: "no-store", credentials: "include" });
  const data = await res.json().catch(() => null);
  const map: LeadSourcesMap = {};
  if (data?.ok && Array.isArray(data.sources)) {
    for (const row of data.sources as LeadSourceMeta[]) {
      if (row?.code) map[row.code] = row;
    }
  }
  cachedMap = map;
  return map;
}

function loadLeadSourcesMap(): Promise<LeadSourcesMap> {
  if (cachedMap) return Promise.resolve(cachedMap);
  if (!inflight) {
    inflight = fetchLeadSourcesMap().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Скинути кеш після змін на сторінці «Джерела» (опційно). */
export function invalidateLeadSourcesMapCache() {
  cachedMap = null;
}

/** code → джерело (з mark для емодзі біля хмарки). */
export function useLeadSourcesMap(): LeadSourcesMap {
  const [map, setMap] = useState<LeadSourcesMap>(cachedMap || {});

  useEffect(() => {
    let cancelled = false;
    void loadLeadSourcesMap().then((next) => {
      if (!cancelled) setMap(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return map;
}
