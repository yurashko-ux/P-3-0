// web/app/(admin)/admin/campaigns/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Option = { id: string; name: string };
type Target = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};

type RefData = {
  pipelines: Option[];
  statusesByPipe: Record<string, Option[]>;
};

const fetchJSON = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()) as T;
};

export default function NewCampaignPage() {
  const router = useRouter();

  // довідники
  const [pipelines, setPipelines] = useState<Option[]>([]);
  const [statusesByPipe, setStatusesByPipe] = useState<Record<string, Option[]>>({});
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [errRefs, setErrRefs] = useState<string | null>(null);

  // форма
  const [name, setName] = useState("");
  const [base, setBase] = useState<Target>({});
  const [t1, setT1] = useState<Target>({});
  const [t2, setT2] = useState<Target>({});
  const [texp, setTexp] = useState<Target>({});
  const [v1, setV1] = useState("1");
  const [v2, setV2] = useState("2");
  const [exp, setExp] = useState<number>(7); // ⬅️ редаговане поле кількості днів

  const pipelineNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of pipelines) map[p.id] = p.name;
    return map;
  }, [pipelines]);

  const statusNameById = (pipelineId?: string) => {
    const arr = (pipelineId && statusesByPipe[pipelineId]) || [];
    const map: Record<string, string> = {};
    for (const s of arr) map[s.id] = s.name;
    return map;
  };

  // завантаження довідників
  useEffect(() => {
    (async () => {
      setLoadingRefs(true);
      setErrRefs(null);
      try {
        const pls = await fetchJSON<{ ok: boolean; data: Option[] }>("/api/keycrm/pipelines");
        setPipelines(pls.data || []);

        // завантажимо статуси для всіх воронок (щоб селект статусів не мигав і був доступний одразу)
        const all: Record<string, Option[]> = {};
        await Promise.all(
          (pls.data || []).map(async (p) => {
            try {
              const st = await fetchJSON<{ ok: boolean; data: Option[] }>(`/api/keycrm/statuses/${encodeURIComponent(p.id)}`);
              all[p.id] = st.data || [];
            } catch {
              all[p.id] = [];
            }
          })
        );
        setStatusesByPipe(all);
      } catch (e) {
        setErrRefs("Не вдалося завантажити воронки");
      } finally {
        setLoadingRefs(false);
      }
    })();
  }, []);

  // helpers для оновлення Target, автоматично проставляємо ...Name
  function handleTargetPipeline(setter: (t: Target) => void, current: Target, pipeline?: string) {
    const pipelineName = pipeline ? pipelineNameById[pipeline] : undefined;
    // якщо змінили pipeline — скидаємо status
    setter({ pipeline, pipelineName, status: undefined, statusName: undefined });
  }
  function handleTargetStatus(setter: (t: Target) => void, current: Target, status?: string) {
    const sName = status ? statusNameById(current.pipeline)[status] : undefined;
    setter({ ...current, status, statusName: sName });
  }

  // сабміт
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload = {
        name: name.trim(),
        base,
        t1,
        t2,
        texp,
        v1: v1 || undefined,
        v2: v2 || undefined,
        exp: Number.isFinite(Number(exp)) ? Number(exp) : undefined, // ⬅️ відправляємо як exp
      };

      const r = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const msg = await r.text().catch(() => "");
        throw new Error(msg || `HTTP ${r.status}`);
      }
      // успіх → назад до списку
      router.push("/admin/campaigns");
      router.refresh();
    } catch (e: any) {
      setError("Не вдалося зберегти кампанію");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Нова кампанія</h1>
        <Link href="/admin/campaigns" className="rounded-lg border px-4 py-2 shadow-sm">
          Скасувати
        </Link>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* База */}
        <section className="rounded-2xl border p-4 sm:p-6">
          <h2 className="text-2xl font-bold mb-4">База</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-sm text-slate-600 mb-1">Назва кампанії</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
                placeholder="Назва"
              />
            </div>

            {/* Базова воронка */}
            <div>
              <label className="block text-sm text-slate-600 mb-1">Базова воронка</label>
              <select
                value={base.pipeline || ""}
                onChange={(e) => handleTargetPipeline(setBase, base, e.target.value || undefined)}
                className="w-full rounded-xl border px-3 py-2"
                disabled={loadingRefs}
              >
                <option value="">—</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Базовий статус */}
            <div>
              <label className="block text-sm text-slate-600 mb-1">Базовий статус</label>
              <select
                value={base.status || ""}
                onChange={(e) => handleTargetStatus(setBase, base, e.target.value || undefined)}
                className="w-full rounded-xl border px-3 py-2"
                disabled={loadingRefs || !base.pipeline}
              >
                <option value="">—</option>
                {(statusesByPipe[base.pipeline || ""] || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Вариант №1 */}
        <section className="rounded-2xl border p-4 sm:p-6">
          <h2 className="text-2xl font-bold mb-4">Варіант №1</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Значення</label>
              <input
                value={v1}
                onChange={(e) => setV1(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
                placeholder="1"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Воронка</label>
              <select
                value={t1.pipeline || ""}
                onChange={(e) => handleTargetPipeline(setT1, t1, e.target.value || undefined)}
                className="w-full rounded-xl border px-3 py-2"
                disabled={loadingRefs}
              >
                <option value="">—</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Статус</label>
              <select
                value={t1.status || ""}
                onChange={(e) => handleTargetStatus(setT1, t1, e.target.value || undefined)}
                className="w-full rounded-xl border px-3 py-2"
                disabled={loadingRefs || !t1.pipeline}
              >
                <option value="">—</option>
                {(statusesByPipe[t1.pipeline || ""] || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Вариант №2 */}
        <section className="rounded-2xl border p-4 sm:p-6">
          <h2 className="text-2xl font-bold mb-4">Варіант №2</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Значення</label>
              <input
                value={v2}
                onChange={(e) => setV2(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
                placeholder="2"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Воронка</label>
              <select
                value={t2.pipeline || ""}
                onChange={(e) => handleTargetPipeline(setT2, t2, e.target.value || undefined)}
                className="w-full rounded-xl border px-3 py-2"
                disabled={loadingRefs}
              >
                <option value="">—</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Статус</label>
              <select
                value={t2.status || ""}
                onChange={(e) => handleTargetStatus(setT2, t2, e.target.value || undefined)}
                className="w-full rounded-xl border px-3 py-2"
                disabled={loadingRefs || !t2.pipeline}
              >
                <option value="">—</option>
                {(statusesByPipe[t2.pipeline || ""] || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Expire */}
        <section className="rounded-2xl border p-4 sm:p-6">
          <h2 className="text-2xl font-bold mb-4">Expire</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Кількість днів до експірації</label>
              <input
                type="number"
                min={0}
                step={1}
                value={Number.isFinite(exp) ? exp : 0}
                onChange={(e) => setExp(e.target.value === "" ? 0 : Number(e.target.value))}
                className="w-full rounded-xl border px-3 py-2"
                placeholder="7"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Воронка</label>
              <select
                value={texp.pipeline || ""}
                onChange={(e) => handleTargetPipeline(setTexp, texp, e.target.value || undefined)}
                className="w-full rounded-xl border px-3 py-2"
                disabled={loadingRefs}
              >
                <option value="">—</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Статус</label>
              <select
                value={texp.status || ""}
                onChange={(e) => handleTargetStatus(setTexp, texp, e.target.value || undefined)}
                className="w-full rounded-xl border px-3 py-2"
                disabled={loadingRefs || !texp.pipeline}
              >
                <option value="">—</option>
                {(statusesByPipe[texp.pipeline || ""] || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {errRefs && (
          <div className="rounded-xl border border-red-300 bg-red-50 text-red-700 px-4 py-3">
            {errRefs}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 text-red-700 px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 text-white px-4 py-2 font-medium shadow hover:bg-blue-700 disabled:opacity-60"
          >
            Зберегти
          </button>
          <Link href="/admin/campaigns" className="rounded-lg border px-4 py-2 shadow-sm">
            Скасувати
          </Link>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="rounded-lg border px-4 py-2 shadow-sm"
          >
            Оновити довідники
          </button>
        </div>
      </form>
    </div>
  );
}
