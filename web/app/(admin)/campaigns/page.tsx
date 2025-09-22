// web/app/(admin)/campaigns/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';

type Campaign = {
  id?: string;
  name?: string;
  created_at?: number;
  active?: boolean;
  // база для V1
  base_pipeline_id?: number | null;
  base_status_id?: number | null;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;

  rules?: {
    v1?: { value?: string; op?: 'contains' | 'equals' };
    v2?: { value?: string; op?: 'contains' | 'equals' };
  };

  // експерименти
  exp?: {
    to_pipeline_id?: number | null;
    to_status_id?: number | null;
    to_pipeline_name?: string | null;
    to_status_name?: string | null;

    trigger?: {
      v1?: { value?: string; op?: 'contains' | 'equals' };
      v2?: { value?: string; op?: 'contains' | 'equals' };
    };
  };

  // лічильники (опційно)
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

type ApiListResp = {
  ok: boolean;
  items?: Campaign[];
  count?: number;
  error?: string;
};

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const escaped = name.replace(/[-.[\]{}()*+?^$|\\]/g, '\\$&');
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + escaped + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function getTokenFromClient(): string {
  if (typeof window === 'undefined') return '';
  const c = readCookie('admin_token')?.trim() || '';
  if (c) return c;
  try {
    const ls = window.localStorage.getItem('ADMIN_TOKEN') || '';
    return ls.trim();
  } catch {
    return '';
  }
}

function setTokenOnClient(token: string) {
  if (typeof document !== 'undefined') {
    // cookie на 30 днів
    const days = 30;
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `admin_token=${encodeURIComponent(token)}; path=/; expires=${expires}; SameSite=Lax`;
  }
  try {
    window.localStorage.setItem('ADMIN_TOKEN', token);
  } catch {}
}

function fmtTs(ms?: number) {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function Pair({
  pipelineName,
  statusName,
  pipelineId,
  statusId,
}: {
  pipelineName?: string | null;
  statusName?: string | null;
  pipelineId?: number | null;
  statusId?: number | null;
}) {
  const p = pipelineName || undefined;
  const s = statusName || undefined;
  const pShow = p ?? (pipelineId ?? '—');
  const sShow = s ?? (statusId ?? '—');
  return <span className="whitespace-nowrap">{pShow} → {sShow}</span>;
}

function Rule({ r }: { r?: { value?: string; op?: 'contains' | 'equals' } }) {
  if (!r || !r.value) return <span className="text-gray-400">—</span>;
  return (
    <code className="rounded bg-gray-100 px-1 py-0.5">
      {r.op || 'contains'}: “{r.value}”
    </code>
  );
}

export default function CampaignsPage() {
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Campaign[] | null>(null);

  // 1) на маунт зчитуємо токен
  useEffect(() => {
    const t = getTokenFromClient();
    setToken(t);
  }, []);

  // 2) фетчимо список, коли є токен
  useEffect(() => {
    let ignore = false;

    async function load() {
      if (!token) return;
      setPending(true);
      setError(null);
      try {
        const res = await fetch(`/api/campaigns?token=${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const data: ApiListResp = await res.json().catch(() => ({ ok: false, error: 'Bad JSON' }));
        if (ignore) return;

        if (!data.ok) {
          setError(data.error || `HTTP ${res.status}`);
          setItems(null);
        } else {
          setItems(data.items || []);
        }
      } catch (e: any) {
        if (ignore) return;
        setError(e?.message || String(e));
        setItems(null);
      } finally {
        if (!ignore) setPending(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [token]);

  const onSaveToken = (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const fd = new FormData(form);
    const t = String(fd.get('token') || '').trim();
    if (!t) return;
    setTokenOnClient(t);
    setToken(t);
  };

  const body = useMemo(() => {
    if (!token) {
      return (
        <div className="max-w-xl rounded-2xl border p-5 shadow-sm">
          <h2 className="mb-2 text-xl font-semibold">Потрібен admin token</h2>
          <p className="mb-4 text-sm text-gray-600">
            Вкажи значення змінної середовища <code>ADMIN_TOKEN</code>.
            Ми збережемо його у <code>cookie</code> та <code>localStorage</code>.
          </p>
          <form onSubmit={onSaveToken} className="flex gap-2">
            <input
              name="token"
              type="password"
              placeholder="Встав сюди ADMIN_TOKEN"
              className="flex-1 rounded-xl border px-3 py-2"
            />
            <button
              type="submit"
              className="rounded-xl bg-black px-4 py-2 font-medium text-white"
            >
              Зберегти
            </button>
          </form>
        </div>
      );
    }

    if (pending && !items) {
      return <div className="text-gray-600">Завантаження…</div>;
    }

    if (error) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          Помилка: {error}
        </div>
      );
    }

    const list = items || [];

    if (!list.length) {
      return <div className="text-gray-600">Немає кампаній.</div>;
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-sm text-gray-600">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Назва</th>
              <th className="px-3 py-2">Створено</th>
              <th className="px-3 py-2">Активна</th>
              <th className="px-3 py-2">V1 база</th>
              <th className="px-3 py-2">V1</th>
              <th className="px-3 py-2">V2</th>
              <th className="px-3 py-2">EXP →</th>
              <th className="px-3 py-2">EXP тригери</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="rounded-xl bg-white shadow-sm">
                <td className="px-3 py-2 font-mono text-xs text-gray-500">{c.id}</td>
                <td className="px-3 py-2">{c.name || '—'}</td>
                <td className="px-3 py-2">{fmtTs(c.created_at)}</td>
                <td className="px-3 py-2">{c.active ? '✅' : '—'}</td>

                <td className="px-3 py-2">
                  <Pair
                    pipelineName={c.base_pipeline_name}
                    statusName={c.base_status_name}
                    pipelineId={c.base_pipeline_id ?? null}
                    statusId={c.base_status_id ?? null}
                  />
                </td>

                <td className="px-3 py-2">
                  <Rule r={c.rules?.v1} />
                </td>

                <td className="px-3 py-2">
                  <Rule r={c.rules?.v2} />
                </td>

                <td className="px-3 py-2">
                  <Pair
                    pipelineName={c.exp?.to_pipeline_name}
                    statusName={c.exp?.to_status_name}
                    pipelineId={c.exp?.to_pipeline_id ?? null}
                    statusId={c.exp?.to_status_id ?? null}
                  />
                </td>

                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    <div>
                      <span className="mr-1 text-xs uppercase text-gray-500">V1</span>
                      <Rule r={c.exp?.trigger?.v1} />
                    </div>
                    <div>
                      <span className="mr-1 text-xs uppercase text-gray-500">V2</span>
                      <Rule r={c.exp?.trigger?.v2} />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }, [token, pending, error, items]);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Кампанії</h1>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            Токен: {token ? '✅' : '—'}
          </span>
          {token && (
            <button
              className="rounded-lg border px-2 py-1 text-xs"
              onClick={() => {
                setTokenOnClient('');
                setToken('');
              }}
              title="Видалити токен"
            >
              Вийти
            </button>
          )}
        </div>
      </div>

      {body}
    </main>
  );
}
