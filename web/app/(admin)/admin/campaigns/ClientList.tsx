'use client';

import { useEffect, useMemo, useState } from 'react';

type Counters = { v1?: number; v2?: number; exp?: number };

type Campaign = {
  id: string;
  name?: string;
  v1?: { value?: string };
  v2?: { value?: string };
  base?: { pipeline?: string; status?: string; pipelineName?: string; statusName?: string };
  counters?: Counters;
  createdAt?: string | number | Date;
  deleted?: boolean;
};

type ApiList = { ok: boolean; items?: Campaign[]; count?: number };
type ApiItem = { ok: boolean; item?: Campaign };

function normalizeId(raw: unknown): string {
  let cur: unknown = raw;

  for (let i = 0; i < 3; i++) {
    if (typeof cur === 'string') {
      const s = cur.trim();
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('"') && s.endsWith('"'))) {
        try {
          cur = JSON.parse(s);
          continue;
        } catch {
          return s;
        }
      }
      return s;
    }
    if (cur && typeof cur === 'object' && 'value' in (cur as any)) {
      // @ts-ignore
      cur = (cur as any).value;
      continue;
    }
    break;
  }
  if (typeof cur === 'string') return cur;
  return String(cur ?? '');
}

function fmtDate(x?: string | number | Date) {
  if (!x) return '—';
  try {
    const d = new Date(x);
    if (Number.isNaN(+d)) return '—';
    return d.toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default function ClientList() {
  const [data, setData] = useState<ApiList>({ ok: true, items: [], count: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/campaigns', { cache: 'no-store' });
      const json = (await res.json()) as ApiList;
      const items = (json.items ?? []).map((c) => ({ ...c, id: normalizeId(c.id) }));
      setData({ ok: json.ok, items, count: json.count ?? items.length });
      // після першого завантаження запускаємо гідрацію
      void hydrate(items);
    } catch (e: any) {
      setErr(e?.message || 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }

  // Гідрація: підтягнути деталі для тих елементів, де їх немає
  async function hydrate(list: Campaign[]) {
    if (!list?.length) return;
    const need = list.filter(
      (c) =>
        !c?.name ||
        !c?.base?.pipelineName ||
        !c?.base?.statusName ||
        typeof c?.counters?.v1 !== 'number' ||
        typeof c?.counters?.v2 !== 'number' ||
        typeof c?.counters?.exp !== 'number'
    );
    if (!need.length) return;

    setHydrating(true);
    try {
      const results = await Promise.allSettled(
        need.map((c) =>
          fetch(`/api/campaigns/${encodeURIComponent(c.id)}`, { cache: 'no-store' })
            .then((r) => r.json() as Promise<ApiItem>)
            .catch(() => ({ ok: false }) as ApiItem)
        )
      );

      const detailsMap = new Map<string, Campaign>();
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.ok && r.value.item) {
          const full = r.value.item;
          full.id = normalizeId(full.id);
         
