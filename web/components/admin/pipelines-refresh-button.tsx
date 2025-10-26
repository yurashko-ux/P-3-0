// web/components/admin/pipelines-refresh-button.tsx
'use client';

import { useState } from 'react';

type State = 'idle' | 'loading' | 'success' | 'error';

export default function PipelinesRefreshButton() {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = async () => {
    if (state === 'loading') return;
    setState('loading');
    setMessage(null);

    try {
      const res = await fetch('/api/keycrm/pipelines', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.ok === false) {
        const reason =
          (data && (data.details || data.error || data.message)) ||
          `${res.status} ${res.statusText}`;
        setState('error');
        setMessage(typeof reason === 'string' ? reason : 'Не вдалося оновити.');
        return;
      }

      const count = Array.isArray(data.pipelines) ? data.pipelines.length : 0;
      setState('success');
      setMessage(
        count > 0
          ? `Оновлено ${count} воронок із KeyCRM.`
          : 'Оновлення виконано, але воронки не повернуті.'
      );
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Невідома помилка.');
    }
  };

  const label =
    state === 'loading'
      ? 'Оновлюємо…'
      : state === 'success'
        ? 'Воронки оновлено'
        : 'Оновити воронки';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === 'loading'}
        className="rounded-lg border px-4 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
      >
        {label}
      </button>
      {message && (
        <p
          className={`text-xs ${state === 'error' ? 'text-red-600' : 'text-slate-500'} max-w-xs text-right`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
