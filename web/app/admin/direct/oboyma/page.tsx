// web/app/admin/direct/oboyma/page.tsx
// Конструктор правил «Обойма» — автоматичні дедлайни колонки «Передзвонити».

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { OboymaDeadlineRule, OboymaTriggerMeta } from "@/lib/direct-oboyma-rules";

type LoadState = { loading: boolean; error: string | null };

function newEmptyRule(triggers: OboymaTriggerMeta[]): OboymaDeadlineRule {
  const first = triggers[0]?.key ?? "stub_not_implemented";
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `rule_${Date.now()}`,
    active: true,
    triggerKey: first,
    offsetDays: 0,
    comment: "",
    order: 0,
  };
}

export default function OboymaPage() {
  const [load, setLoad] = useState<LoadState>({ loading: true, error: null });
  const [triggers, setTriggers] = useState<OboymaTriggerMeta[]>([]);
  const [rules, setRules] = useState<OboymaDeadlineRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoad({ loading: true, error: null });
    setSaveMessage(null);
    try {
      const res = await fetch("/api/admin/direct/oboyma/rules", {
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setTriggers(Array.isArray(data.triggers) ? data.triggers : []);
      setRules(Array.isArray(data.rules) ? data.rules : []);
    } catch (e) {
      setLoad({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    setLoad({ loading: false, error: null });
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/admin/direct/oboyma/rules", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setRules(Array.isArray(data.rules) ? data.rules : rules);
      setSaveMessage("Збережено.");
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const updateRule = (index: number, patch: Partial<OboymaDeadlineRule>) => {
    setRules((prev) => {
      const next = [...prev];
      const cur = next[index];
      if (!cur) return prev;
      next[index] = { ...cur, ...patch };
      return next;
    });
  };

  const removeRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Link href="/admin/direct" className="btn btn-sm btn-ghost">
            ← Direct
          </Link>
          <h1 className="text-lg font-semibold">Обойма</h1>
          <span className="text-xs text-base-content/70">
            Правила автоматичних дедлайнів для колонки «Передзвонити»
          </span>
        </div>

        <div className="bg-base-100 rounded-lg border border-base-300 p-4 mb-4 text-sm">
          <p className="text-base-content/80 mb-2">
            У кожному правилі: <strong>тригер</strong>, <strong>зміщення днів</strong> від дня події (семантику
            задає тип тригера), <strong>коментар</strong>. Якщо у клієнта вже є майбутній дедлайн у
            «Передзвонити», автоматика лише дописує запис у історію, не змінюючи поточну дату в колонці.
          </p>
          <p className="text-xs text-base-content/60">
            Підключення реальних подій (Binotel, Altegio тощо) додається окремо після вибору тригерів у коді.
          </p>
        </div>

        {load.loading && <div className="text-sm">Завантаження…</div>}
        {load.error && (
          <div className="alert alert-error text-sm mb-4">
            <span>{load.error}</span>
            <button type="button" className="btn btn-xs" onClick={() => void loadData()}>
              Повторити
            </button>
          </div>
        )}

        {!load.loading && !load.error && (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={saving}
                onClick={() => setRules((r) => [...r, newEmptyRule(triggers)])}
              >
                + Правило
              </button>
              <button type="button" className="btn btn-sm btn-outline" disabled={saving} onClick={() => void handleSave()}>
                {saving ? "Збереження…" : "Зберегти все"}
              </button>
              {saveMessage && (
                <span className={`text-xs self-center ${saveMessage === "Збережено." ? "text-success" : "text-error"}`}>
                  {saveMessage}
                </span>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-base-300 bg-base-100">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>Активне</th>
                    <th>Тригер</th>
                    <th className="whitespace-nowrap">Дні ±</th>
                    <th>Коментар</th>
                    <th className="w-16">Пор.</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center text-base-content/60 text-sm py-6">
                        Немає правил. Натисніть «+ Правило».
                      </td>
                    </tr>
                  ) : (
                    rules.map((rule, index) => (
                      <tr key={rule.id}>
                        <td className="text-xs text-base-content/50">{index + 1}</td>
                        <td>
                          <input
                            type="checkbox"
                            className="toggle toggle-sm"
                            checked={rule.active}
                            onChange={(e) => updateRule(index, { active: e.target.checked })}
                          />
                        </td>
                        <td>
                          <select
                            className="select select-bordered select-xs max-w-[220px]"
                            value={rule.triggerKey}
                            onChange={(e) => updateRule(index, { triggerKey: e.target.value })}
                          >
                            {triggers.map((t) => (
                              <option key={t.key} value={t.key}>
                                {t.labelUk}
                                {!t.implemented ? " · не підключено" : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            className="input input-bordered input-xs w-20"
                            value={rule.offsetDays}
                            onChange={(e) => updateRule(index, { offsetDays: parseInt(e.target.value, 10) || 0 })}
                          />
                        </td>
                        <td>
                          <textarea
                            className="textarea textarea-bordered textarea-xs w-full min-h-[48px] text-xs"
                            placeholder="Текст у колонці / історії"
                            value={rule.comment}
                            onChange={(e) => updateRule(index, { comment: e.target.value })}
                            rows={2}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="input input-bordered input-xs w-14"
                            value={rule.order ?? 0}
                            onChange={(e) => updateRule(index, { order: parseInt(e.target.value, 10) || 0 })}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs text-error"
                            onClick={() => removeRule(index)}
                          >
                            Видалити
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {triggers.length > 0 && (
              <div className="mt-4 text-xs text-base-content/70 space-y-1">
                <div className="font-semibold text-base-content">Довідка по тригерах</div>
                {triggers.map((t) => (
                  <div key={t.key}>
                    <span className="font-mono text-[10px]">{t.key}</span> — {t.descriptionUk}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
