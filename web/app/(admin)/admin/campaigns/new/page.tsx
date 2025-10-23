// web/app/(admin)/admin/campaigns/new/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

// Компактні утиліти UI
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white px-4 py-4 sm:px-5 sm:py-5">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">{title}</h2>
      <div className="grid gap-3 sm:gap-4">{children}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-slate-600 mb-1">{children}</div>;
}

type IdName = { id: string; name: string };

type TargetState = {
  pipeline?: string;
  status?: string;
  pipelineStatusId?: string;
  pipelineName?: string;
  statusName?: string;
};

type FormState = {
  name: string;
  base: TargetState;
  v1: string;
  v2: string;
  expDays?: number | '';
  t1: TargetState;
  t2: TargetState;
  texp: TargetState;
};

const emptyTarget: TargetState = { pipeline: '', status: '' };

export default function NewCampaignPage() {
  const router = useRouter();

  // компактний state
  const [pipelines, setPipelines] = useState<IdName[]>([]);
  const [statusesByPipe, setStatusesByPipe] = useState<Record<string, IdName[]>>({});

  const [loadingDicts, setLoadingDicts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    name: '',
    base: { ...emptyTarget },
    v1: '1',
    v2: '2',
    expDays: 7,
    t1: { ...emptyTarget },
    t2: { ...emptyTarget },
    texp: { ...emptyTarget },
  });

  // --- Завантаження воронок ---
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingDicts(true);
        setError(null);
        const r = await fetch('/api/keycrm/pipelines', { cache: 'no-store' });
        const js = await r.json();
        if (!alive) return;
        if (!js?.ok) throw new Error('Не вдалося завантажити воронки');
        setPipelines(js.data as IdName[]);
      } catch (e: any) {
        setError(e?.message || 'Помилка завантаження воронок');
      } finally {
        if (alive) setLoadingDicts(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // --- Завантаження статусів для конкретної воронки (з кешуванням у state) ---
  const loadStatuses = async (pipelineId: string) => {
    if (!pipelineId || statusesByPipe[pipelineId]) return;
    try {
      const r = await fetch(`/api/keycrm/statuses/${encodeURIComponent(pipelineId)}`, {
        cache: 'no-store',
      });
      const js = await r.json();
      if (!js?.ok) throw new Error('Не вдалося завантажити статуси');
      setStatusesByPipe((prev) => ({ ...prev, [pipelineId]: js.data as IdName[] }));
    } catch (e) {
      // мʼяко ігноруємо, помилку видно в полях
    }
  };

  const statusesBase = useMemo(
    () => (form.base.pipeline ? statusesByPipe[form.base.pipeline] || [] : []),
    [form.base.pipeline, statusesByPipe]
  );
  const statusesT1 = useMemo(
    () => (form.t1.pipeline ? statusesByPipe[form.t1.pipeline] || [] : []),
    [form.t1.pipeline, statusesByPipe]
  );
  const statusesT2 = useMemo(
    () => (form.t2.pipeline ? statusesByPipe[form.t2.pipeline] || [] : []),
    [form.t2.pipeline, statusesByPipe]
  );
  const statusesTExp = useMemo(
    () => (form.texp.pipeline ? statusesByPipe[form.texp.pipeline] || [] : []),
    [form.texp.pipeline, statusesByPipe]
  );

  // --- helpers ---
  const handleTargetChange = (
    key: 'base' | 't1' | 't2' | 'texp',
    patch: Partial<TargetState>
  ) => {
    setForm((f) => {
      const next = { ...f[key], ...patch } as TargetState;

      // якщо змінилась воронка — підвантажимо статуси і скинемо статус
      if (patch.pipeline !== undefined) {
        if (patch.pipeline) loadStatuses(patch.pipeline);
        next.status = '';
        next.pipelineStatusId = undefined;
        next.pipelineName = pipelines.find((p) => p.id === patch.pipeline)?.name || '';
      }
      if (patch.status !== undefined && patch.status) {
        const list =
          (next.pipeline && statusesByPipe[next.pipeline]) ? statusesByPipe[next.pipeline] : [];
        next.statusName = list.find((s) => s.id === patch.status)?.name || '';
        next.pipelineStatusId = patch.status;
      }
      return { ...f, [key]: next };
    });
  };

  // --- submit ---
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Назва обовʼязкова');
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      v1: form.v1 || undefined,
      v2: form.v2 || undefined,
      expDays:
        form.expDays === '' ? undefined : Number.isFinite(Number(form.expDays)) ? Number(form.expDays) : undefined,
      base: normalizeTarget(form.base),
      t1: normalizeTarget(form.t1),
      t2: normalizeTarget(form.t2),
      texp: normalizeTarget(form.texp),
    };

    try {
      const r = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(txt || 'Не вдалося зберегти кампанію');
      }
      router.push('/admin/campaigns');
      router.refresh();
    } catch (e: any) {
      setError(e?.message || 'Помилка збереження');
    } finally {
      setSaving(false);
    }
  };

  const disabled = loadingDicts || saving;

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      {/* Хедер */}
      <div className="mb-3 sm:mb-4 flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Нова кампанія</h1>
        <button
          type="button"
          onClick={() => router.push('/admin/campaigns')}
          className="rounded-lg border px-3 py-1.5 text-sm shadow-sm"
        >
          Скасувати
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 sm:space-y-5">
        {/* База */}
        <Section title="База">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-5">
              <Label>Назва кампанії</Label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border px-3 py-2"
                placeholder="Назва"
                disabled={disabled}
              />
            </div>
            <div className="sm:col-span-3">
              <Label>Базова воронка</Label>
              <select
                className="w-full rounded-lg border px-3 py-2"
                value={form.base.pipeline || ''}
                onChange={(e) => handleTargetChange('base', { pipeline: e.target.value })}
                disabled={disabled}
              >
                <option value="">—</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-4">
              <Label>Базовий статус</Label>
              <select
                className="w-full rounded-lg border px-3 py-2"
                value={form.base.status || ''}
                onChange={(e) => handleTargetChange('base', { status: e.target.value })}
                disabled={disabled || !form.base.pipeline}
              >
                <option value="">—</option>
                {statusesBase.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>

        {/* Варіант №1 */}
        <Section title="Варіант №1">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-2">
              <Label>Значення</Label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                value={form.v1}
                onChange={(e) => setForm((f) => ({ ...f, v1: e.target.value }))}
                disabled={disabled}
                placeholder="1"
              />
            </div>
            <div className="sm:col-span-5">
              <Label>Воронка</Label>
              <select
                className="w-full rounded-lg border px-3 py-2"
                value={form.t1.pipeline || ''}
                onChange={(e) => handleTargetChange('t1', { pipeline: e.target.value })}
                disabled={disabled}
              >
                <option value="">—</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-5">
              <Label>Статус</Label>
              <select
                className="w-full rounded-lg border px-3 py-2"
                value={form.t1.status || ''}
                onChange={(e) => handleTargetChange('t1', { status: e.target.value })}
                disabled={disabled || !form.t1.pipeline}
              >
                <option value="">—</option>
                {statusesT1.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>

        {/* Варіант №2 */}
        <Section title="Варіант №2">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-2">
              <Label>Значення</Label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                value={form.v2}
                onChange={(e) => setForm((f) => ({ ...f, v2: e.target.value }))}
                disabled={disabled}
                placeholder="2"
              />
            </div>
            <div className="sm:col-span-5">
              <Label>Воронка</Label>
              <select
                className="w-full rounded-lg border px-3 py-2"
                value={form.t2.pipeline || ''}
                onChange={(e) => handleTargetChange('t2', { pipeline: e.target.value })}
                disabled={disabled}
              >
                <option value="">—</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-5">
              <Label>Статус</Label>
              <select
                className="w-full rounded-lg border px-3 py-2"
                value={form.t2.status || ''}
                onChange={(e) => handleTargetChange('t2', { status: e.target.value })}
                disabled={disabled || !form.t2.pipeline}
              >
                <option value="">—</option>
                {statusesT2.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>

        {/* Expire */}
        <Section title="Expire">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-2">
              <Label>Кількість днів до експірації</Label>
              <input
                type="number"
                min={0}
                className="w-full rounded-lg border px-3 py-2"
                value={form.expDays ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, expDays: e.target.value === '' ? '' : Number(e.target.value) }))
                }
                disabled={disabled}
                placeholder="7"
              />
            </div>
            <div className="sm:col-span-5">
              <Label>Воронка</Label>
              <select
                className="w-full rounded-lg border px-3 py-2"
                value={form.texp.pipeline || ''}
                onChange={(e) => handleTargetChange('texp', { pipeline: e.target.value })}
                disabled={disabled}
              >
                <option value="">—</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-5">
              <Label>Статус</Label>
              <select
                className="w-full rounded-lg border px-3 py-2"
                value={form.texp.status || ''}
                onChange={(e) => handleTargetChange('texp', { status: e.target.value })}
                disabled={disabled || !form.texp.pipeline}
              >
                <option value="">—</option>
                {statusesTExp.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>

        {/* Кнопки */}
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={disabled}
            className="rounded-lg bg-blue-600 text-white px-4 py-2 font-medium shadow hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Збереження…' : 'Зберегти'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/admin/campaigns')}
            className="rounded-lg border px-4 py-2 shadow-sm"
          >
            Скасувати
          </button>
        </div>
      </form>
    </div>
  );
}

// нормалізуємо Target до бекенду: якщо pipeline/status порожні — не шлемо
function normalizeTarget(t: TargetState): TargetState | undefined {
  if (!t?.pipeline && !t?.status) return undefined;
  const out: TargetState = {};
  if (t.pipeline) out.pipeline = t.pipeline;
  if (t.status) out.status = t.status;
  if (t.pipelineStatusId) out.pipelineStatusId = t.pipelineStatusId;
  if (t.pipelineName) out.pipelineName = t.pipelineName;
  if (t.statusName) out.statusName = t.statusName;
  return out;
}
