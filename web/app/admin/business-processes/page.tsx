// Бізнес-процеси: список процесів салону і їхній конструктор. Стиль — як у Фінансах і Касі.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { navTileClass } from "@/app/admin/_components/nav-tile";
import {
  describeAssignee,
  describeDeadline,
  describeTrigger,
  PROCESS_KIND_LABELS,
} from "@/lib/business-processes/config";
import type { BusinessProcessRow, ProcessTeamMember } from "@/lib/business-processes/store";
import { BP_HEADER_ACTIONS_ID } from "./_components/BusinessProcessesChrome";
import { ProcessEditor } from "./_components/ProcessEditor";
import { Switch } from "./_components/Switch";
import { KIND_TINT, UI } from "./_components/ui";

type EditorState = { mode: "create" } | { mode: "edit"; process: BusinessProcessRow } | null;

const INACTIVE_TINT = "#eef0f4";

export default function BusinessProcessesPage() {
  const [processes, setProcesses] = useState<BusinessProcessRow[]>([]);
  const [members, setMembers] = useState<ProcessTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHeaderSlot(document.getElementById(BP_HEADER_ACTIONS_ID));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/business-processes", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося завантажити процеси");
      setProcesses(json.processes || []);
      setMembers(json.members || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const memberName = useMemo(() => {
    const byId = new Map(members.map((m) => [m.id, m.name]));
    return (id: string) => byId.get(id);
  }, [members]);

  async function toggleActive(process: BusinessProcessRow) {
    setBusyId(process.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/business-processes/${process.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !process.isActive }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не збережено");
      setProcesses((rows) => rows.map((row) => (row.id === process.id ? json.process : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(process: BusinessProcessRow) {
    if (!confirm(`Видалити процес «${process.title}»?`)) return;
    setBusyId(process.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/business-processes/${process.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не видалено");
      setProcesses((rows) => rows.filter((row) => row.id !== process.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setBusyId(null);
    }
  }

  function onSaved(saved: BusinessProcessRow) {
    setProcesses((rows) => {
      const exists = rows.some((row) => row.id === saved.id);
      return exists ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows];
    });
    setEditor(null);
  }

  const headerActions =
    headerSlot && !editor
      ? createPortal(
          <>
            <button type="button" className={navTileClass(false)} onClick={() => setEditor({ mode: "create" })}>
              + Новий процес
            </button>
            <button type="button" className={navTileClass(false)} disabled={loading} onClick={() => void load()}>
              {loading ? "Оновлюю…" : "Оновити"}
            </button>
          </>,
          headerSlot,
        )
      : null;

  if (editor) {
    return (
      <main className="p-3">
        <ProcessEditor
          initial={editor.mode === "edit" ? editor.process : null}
          members={members}
          onCancel={() => setEditor(null)}
          onSaved={onSaved}
        />
      </main>
    );
  }

  return (
    <main className="p-3 space-y-3">
      {headerActions}
      <p className="text-xs text-gray-600">
        Процес — правило салону: коли запускати, кому дати завдання і що відповісти. Завдання надсилатиме Telegram-бот:
        майстрам — бот майстрів, решті — окремий бот. Зміни налаштувань діють лише для нових завдань.
      </p>
      {error && <div className={UI.error}>{error}</div>}

      {loading && processes.length === 0 ? (
        <p className="text-sm text-gray-500">Завантаження…</p>
      ) : processes.length === 0 && !error ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
          <button
            type="button"
            onClick={() => setEditor({ mode: "create" })}
            className="flex min-h-[120px] items-center justify-center rounded-2xl bg-[#e3edf9] text-sm font-semibold text-gray-800 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_18px_-10px_rgba(15,23,42,0.25)] transition hover:brightness-[0.97]"
          >
            + Перший процес
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
          {processes.map((process) => {
            const tint = process.isActive ? KIND_TINT[process.kind] : INACTIVE_TINT;
            return (
              <article key={process.id} className={`${UI.card} flex flex-col overflow-hidden`}>
                <div className="flex items-start justify-between gap-2 px-3 py-2.5" style={{ background: tint }}>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      {PROCESS_KIND_LABELS[process.kind]} · версія {process.version}
                    </div>
                    <div className="truncate text-sm font-semibold text-gray-900" title={process.title}>
                      {process.title}
                    </div>
                  </div>
                  <Switch
                    checked={process.isActive}
                    disabled={busyId === process.id}
                    onChange={() => void toggleActive(process)}
                  />
                </div>
                <dl className="flex-1 space-y-1 px-3 py-2.5 text-xs">
                  {process.description && <p className="pb-1 text-gray-600">{process.description}</p>}
                  <Row label="Запуск" value={describeTrigger(process.config.trigger)} />
                  <Row label="Виконавець" value={describeAssignee(process.config.assignee, memberName)} />
                  <Row
                    label="Контроль"
                    value={
                      process.config.controllerIds.length > 0
                        ? process.config.controllerIds.map((id) => memberName(id) || "—").join(", ")
                        : "—"
                    }
                  />
                  <Row
                    label={process.kind === "task_report" ? "Звіт" : "Текст"}
                    value={
                      process.kind === "task_report"
                        ? `${process.config.fields.length} питань`
                        : process.config.messageTemplate
                    }
                  />
                  <Row label="Строк" value={describeDeadline(process.config.deadline)} />
                </dl>
                <div className="flex justify-end gap-1.5 border-t border-slate-100 px-3 py-2">
                  <button type="button" className={UI.headerButton} onClick={() => setEditor({ mode: "edit", process })}>
                    Змінити
                  </button>
                  <button
                    type="button"
                    className={UI.headerDanger}
                    disabled={busyId === process.id}
                    onClick={() => void remove(process)}
                  >
                    Видалити
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className="line-clamp-2 text-gray-900">{value}</dd>
    </div>
  );
}
