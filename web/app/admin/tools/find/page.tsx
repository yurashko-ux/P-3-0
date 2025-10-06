// web/app/admin/tools/find/page.tsx
'use client';

import { useMemo, useState } from 'react';

export const dynamic = 'force-dynamic';

type ApiResponse = any;

const strategies = [
  { value: 'both', label: 'both (social + title)' },
  { value: 'social', label: 'social only' },
  { value: 'title', label: 'title only' },
];

const titleModes = [
  { value: 'exact', label: 'exact (Чат з ...)' },
  { value: 'contains', label: 'contains' },
];

const scopes = [
  { value: 'campaign', label: 'campaign (враховує базову воронку)' },
  { value: 'global', label: 'global (усі картки)' },
];

export default function FindToolPage() {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [socialName, setSocialName] = useState('instagram');
  const [scope, setScope] = useState<'campaign' | 'global'>('campaign');
  const [pipelineId, setPipelineId] = useState('');
  const [statusId, setStatusId] = useState('');
  const [maxPages, setMaxPages] = useState('3');
  const [pageSize, setPageSize] = useState('50');
  const [strategy, setStrategy] = useState<'both' | 'social' | 'title'>('both');
  const [titleMode, setTitleMode] = useState<'exact' | 'contains'>('exact');

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryPreview = useMemo(() => {
    const qs = new URLSearchParams();
    if (username.trim()) qs.set('username', username.trim());
    if (fullName.trim()) qs.set('full_name', fullName.trim());
    if (socialName.trim()) qs.set('social_name', socialName.trim());
    if (scope) qs.set('scope', scope);
    if (pipelineId.trim()) qs.set('pipeline_id', pipelineId.trim());
    if (statusId.trim()) qs.set('status_id', statusId.trim());
    if (maxPages.trim()) qs.set('max_pages', maxPages.trim());
    if (pageSize.trim()) qs.set('page_size', pageSize.trim());
    if (strategy) qs.set('strategy', strategy);
    if (titleMode) qs.set('title_mode', titleMode);
    return qs.toString();
  }, [username, fullName, socialName, scope, pipelineId, statusId, maxPages, pageSize, strategy, titleMode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResponse(null);

    const qs = new URLSearchParams(queryPreview);

    try {
      const res = await fetch(`/api/keycrm/find?${qs.toString()}`, {
        credentials: 'include',
      });
      const json = await res.json();
      setResponse(json);
      if (!res.ok || json?.ok === false) {
        setError(json?.message || json?.error || 'Запит виконано з помилкою');
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">KeyCRM Find tester</h1>
        <a href="/admin/tools" className="rounded-full border px-3 py-1.5 text-sm">
          ← До інструментів
        </a>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-5">
        <section className="rounded-2xl border p-4 md:p-6">
          <h2 className="mb-4 text-lg font-semibold">Параметри пошуку</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="username" value={username} onChange={setUsername} placeholder="kolachnyk.v" />
            <Field label="Повне ім'я (Чат з ...)" value={fullName} onChange={setFullName} placeholder="Viktoria Kolachnyk" />
            <Field label="social_name" value={socialName} onChange={setSocialName} placeholder="instagram" />
            <Select
              label="scope"
              value={scope}
              options={scopes}
              onChange={(v) => setScope((v as 'campaign' | 'global') || 'campaign')}
            />
            <Field
              label="pipeline_id"
              value={pipelineId}
              onChange={setPipelineId}
              placeholder="1"
              disabled={scope !== 'campaign'}
            />
            <Field
              label="status_id"
              value={statusId}
              onChange={setStatusId}
              placeholder="38"
              disabled={scope !== 'campaign'}
            />
            <Field label="max_pages" value={maxPages} onChange={setMaxPages} placeholder="3" />
            <Field label="page_size" value={pageSize} onChange={setPageSize} placeholder="50" />
            <Select
              label="strategy"
              value={strategy}
              options={strategies}
              onChange={(v) => setStrategy((v as 'both' | 'social' | 'title') || 'both')}
            />
            <Select
              label="title_mode"
              value={titleMode}
              options={titleModes}
              onChange={(v) => setTitleMode((v as 'exact' | 'contains') || 'exact')}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? 'Виконуємо...' : 'Запустити пошук'}
            </button>
            <button
              type="button"
              onClick={() => {
                setResponse(null);
                setError(null);
              }}
              className="rounded-lg border px-4 py-2 text-sm"
            >
              Очистити результат
            </button>
            <code className="text-xs text-gray-500">GET /api/keycrm/find?{queryPreview || '…'}</code>
          </div>
        </section>
      </form>

      <section className="mt-6 rounded-2xl border p-4 md:p-6">
        <h2 className="mb-3 text-lg font-semibold">Відповідь</h2>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {response ? (
          <pre className="max-h-96 overflow-auto rounded-lg border bg-gray-50 p-3 text-xs">
            {JSON.stringify(response, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-gray-500">Виконайте запит, щоб побачити відповідь KeyCRM.</p>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-gray-600">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="rounded-lg border px-3 py-2 text-sm outline-none disabled:bg-gray-100"
      />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-gray-600">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border px-3 py-2 text-sm outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
