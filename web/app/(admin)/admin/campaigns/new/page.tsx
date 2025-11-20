// web/app/(admin)/admin/campaigns/new/page.tsx
'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

// Компактні утиліти UI
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-white px-4 py-4 sm:px-5 sm:py-5">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">{title}</h2>
      <div className="grid gap-3 sm:gap-4">{children}</div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="text-sm text-slate-600 mb-1">{children}</div>;
}

function formatStatusOptionLabel(option: StatusOption): string {
  const extras: string[] = [];
  if (option.pipelineStatusId) {
    extras.push(`PS:${option.pipelineStatusId}`);
  }
  if (option.statusId && option.statusId !== option.pipelineStatusId) {
    extras.push(`S:${option.statusId}`);
  }
  if (!extras.length) {
    return option.name;
  }
  return `${option.name} (${extras.join(' · ')})`;
}

function TargetDiagnostics({ target }: { target: TargetState }) {
  if (!target.pipeline || !target.status) {
    return null;
  }

  if (target.pipelineStatusId) {
    return (
      <p className="text-xs text-slate-500 leading-relaxed">
        pipeline_status_id: {target.pipelineStatusId}
        {target.statusId && target.statusId !== target.pipelineStatusId
          ? ` · status_id: ${target.statusId}`
          : ''}
      </p>
    );
  }

  return (
    <p className="text-xs text-red-600 leading-relaxed">
      KeyCRM не повернув <code>pipeline_status_id</code> для обраного статусу. Оновіть довідник
      на сторінці «Debug» або оберіть інший статус у цій воронці.
    </p>
  );
}

type IdName = { id: string; name: string };

type StatusOption = {
  id: string;
  name: string;
  pipelineStatusId?: string | null;
  statusId?: string | null;
};

type TargetState = {
  pipeline?: string;
  status?: string;
  pipelineStatusId?: string;
  statusId?: string;
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

function targetNeedsPipelineStatus(target?: TargetState | null): boolean {
  return Boolean(target?.pipeline && target?.status && !target?.pipelineStatusId);
}

function collectMissingSections(state: FormState): string[] {
  const sections: string[] = [];
  if (targetNeedsPipelineStatus(state.base)) sections.push('База');
  if (targetNeedsPipelineStatus(state.t1)) sections.push('Варіант №1');
  if (targetNeedsPipelineStatus(state.t2)) sections.push('Варіант №2');
  if (targetNeedsPipelineStatus(state.texp)) sections.push('Expire');
  return sections;
}

export default function NewCampaignPage() {
  const router = useRouter();

  // компактний state
  const [pipelines, setPipelines] = useState<IdName[]>([]);
  const [statusesByPipe, setStatusesByPipe] = useState<Record<string, StatusOption[]>>({});

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
        const js = await r.json().catch(() => null);
        if (!alive) return;
        if (!js || js.ok === false) {
          throw new Error(js?.details || js?.error || 'Не вдалося завантажити воронки');
        }

        const rawList = Array.isArray(js.pipelines)
          ? js.pipelines
          : Array.isArray(js.data)
            ? js.data
            : [];

        const nextPipelines: IdName[] = [];
        const nextStatuses: Record<string, IdName[]> = {};

        for (const item of rawList as any[]) {
          const idValue = item?.id ?? item?.pipeline_id ?? item?.uuid ?? item?.ID;
          const id = idValue != null ? String(idValue) : '';
          if (!id) continue;
          const name = String(
            item?.title ?? item?.name ?? item?.label ?? `Воронка #${id}`
          );
          nextPipelines.push({ id, name });

          const statusBuckets: any[] = [];
          const candidates = [
            item?.statuses,
            item?.pipeline_statuses,
            item?.statuses?.data,
            item?.statuses?.items,
            item?.statuses?.list,
          ];
          for (const bucket of candidates) {
            if (Array.isArray(bucket)) {
              statusBuckets.push(...bucket);
            }
          }

          if (statusBuckets.length) {
            const mapped = statusBuckets
              .map((status) => {
                const pipelineStatusSource =
                  status?.pipeline_status_id ??
                  status?.pivot?.pipeline_status_id ??
                  status?.pivot?.status_id ??
                  status?.pipelineStatusId ??
                  status?.pipeline_statusId ??
                  null;
                const statusSource =
                  status?.status_id ??
                  status?.status?.id ??
                  status?.statusId ??
                  status?.pivot?.status_id ??
                  null;
                const fallbackId = status?.id ?? status?.uuid ?? status?.ID ?? null;

                const pipelineStatusId =
                  pipelineStatusSource != null && pipelineStatusSource !== ''
                    ? String(pipelineStatusSource)
                    : undefined;
                const statusId =
                  statusSource != null && statusSource !== '' ? String(statusSource) : undefined;
                const optionId = pipelineStatusId ?? statusId ?? (fallbackId != null ? String(fallbackId) : undefined);
                if (!optionId) {
                  return null;
                }

                const statusName = String(
                  status?.title ?? status?.name ?? status?.label ?? `Статус #${optionId}`,
                );

                const result: StatusOption = {
                  id: optionId,
                  name: statusName,
                  pipelineStatusId: pipelineStatusId ?? null,
                  statusId: statusId ?? null,
                };
                return result;
              })
              .filter((value): value is StatusOption => Boolean(value));

            if (mapped.length) {
              const deduped = Array.from(
                new Map(mapped.map((entry) => [entry.id, entry])).values(),
              );
              nextStatuses[id] = deduped;
            }
          }
        }

        setPipelines(nextPipelines);
        if (Object.keys(nextStatuses).length) {
          setStatusesByPipe((prev) => ({ ...prev, ...nextStatuses }));
        }
      } catch (e: any) {
        if (alive) {
          setError(e?.message || 'Помилка завантаження воронок');
        }
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

      const mapped: StatusOption[] = Array.isArray(js.data)
        ? js.data.map((item: any) => ({
            id: String(item?.id ?? ''),
            name: String(item?.name ?? `Статус #${item?.id ?? ''}`),
            pipelineStatusId:
              item?.pipelineStatusId != null && item.pipelineStatusId !== ''
                ? String(item.pipelineStatusId)
                : item?.pipeline_status_id != null && item.pipeline_status_id !== ''
                  ? String(item.pipeline_status_id)
                  : null,
            statusId:
              item?.statusId != null && item.statusId !== ''
                ? String(item.statusId)
                : item?.status_id != null && item.status_id !== ''
                  ? String(item.status_id)
                  : null,
          }))
        : [];

      setStatusesByPipe((prev) => ({ ...prev, [pipelineId]: mapped }));
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
        next.statusId = undefined;
        next.pipelineStatusId = undefined;
        next.statusName = '';
        next.pipelineName = pipelines.find((p) => p.id === patch.pipeline)?.name || '';
      }
      if (patch.status !== undefined && patch.status) {
        const list =
          next.pipeline && statusesByPipe[next.pipeline]
            ? statusesByPipe[next.pipeline]
            : [];
        const option = list.find((s) => s.id === patch.status);
        next.status = patch.status;
        next.statusName = option?.name || '';
        next.pipelineStatusId = option?.pipelineStatusId ?? undefined;
        next.statusId = option?.statusId ?? option?.pipelineStatusId ?? patch.status;
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
    const blockingSections = collectMissingSections(form);
    if (blockingSections.length) {
      setError(
        `Не вдалось зберегти: KeyCRM не повернув pipeline_status_id для секцій ${blockingSections.join(
          ', ',
        )}. Оновіть довідник статусів у розділі Debug або оберіть інші статуси.`,
      );
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
  const missingSections = useMemo(() => collectMissingSections(form), [form]);
  const hasBlockingPipelineStatuses = missingSections.length > 0;

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
                    {formatStatusOptionLabel(s)}
                  </option>
                ))}
              </select>
              <TargetDiagnostics target={form.base} />
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
                    {formatStatusOptionLabel(s)}
                  </option>
                ))}
              </select>
              <TargetDiagnostics target={form.t1} />
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
                    {formatStatusOptionLabel(s)}
                  </option>
                ))}
              </select>
              <TargetDiagnostics target={form.t2} />
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
                    {formatStatusOptionLabel(s)}
                  </option>
                ))}
              </select>
              <TargetDiagnostics target={form.texp} />
            </div>
          </div>
        </Section>

        {/* Кнопки */}
        {hasBlockingPipelineStatuses && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            KeyCRM не повернув <code>pipeline_status_id</code> для секцій {missingSections.join(', ')}. Оновіть
            довідник статусів у розділі «Debug» або оберіть інші статуси перед збереженням.
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={disabled || hasBlockingPipelineStatuses}
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
  if (t.statusId) out.status = t.statusId;
  else if (t.pipelineStatusId) out.status = t.pipelineStatusId;
  else if (t.status) out.status = t.status;
  if (t.pipelineStatusId) out.pipelineStatusId = t.pipelineStatusId;
  if (t.pipelineName) out.pipelineName = t.pipelineName;
  if (t.statusName) out.statusName = t.statusName;
  return out;
}
