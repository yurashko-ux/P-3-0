// Конструктор одного бізнес-процесу: хто, коли, що відповісти, строки. Стиль — як документ Каси.
"use client";

import { useMemo, useState } from "react";
import {
  defaultProcessConfig,
  DURATION_UNIT_LABELS,
  emptyField,
  EVENTS_WITH_BEFORE,
  EVENTS_WITH_MASTER,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  MESSAGE_PLACEHOLDERS,
  normalizeProcessConfig,
  PROCESS_EVENT_LABELS,
  PROCESS_EVENTS,
  PROCESS_KIND_LABELS,
  PROCESS_KINDS,
  TEAM_ROLE_LABELS,
  validateProcess,
  type BusinessProcessConfig,
  type DurationUnit,
  type FieldType,
  type ProcessAssignee,
  type ProcessDuration,
  type ProcessEvent,
  type ProcessField,
  type ProcessKind,
  type ProcessTrigger,
} from "@/lib/business-processes/config";
import type {
  BusinessProcessRow,
  ProcessTeamMember,
} from "@/lib/business-processes/store";
import type { TeamSalonRole } from "@/lib/team/constants";
import { Switch } from "./Switch";
import { KIND_TINT, pill, segment, segmentWrap, UI } from "./ui";

const UNITS: DurationUnit[] = ["minutes", "hours", "days"];
const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];

/** Приклад підстановок для перегляду повідомлення. */
const PREVIEW_VALUES: Record<string, string> = {
  "{ім'я}": "Олена",
  "{дата}": "15 листопада",
  "{час}": "10:00",
  "{майстер}": "Галина",
  "{послуга}": "Капсульне нарощування",
};

function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={UI.block}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={UI.blockTitle}>{title}</span>
        {hint && <span className={UI.hint}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  top,
  children,
}: {
  label: string;
  top?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={top ? UI.rowTop : UI.row}>
      <span className={`${UI.label} ${top ? "sm:pt-2" : ""}`}>{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function DurationInput({
  value,
  onChange,
  min = 0,
}: {
  value: ProcessDuration;
  onChange: (next: ProcessDuration) => void;
  min?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min={min}
        className={`${UI.inputAuto} w-12 text-center tabular-nums`}
        value={value.amount}
        onChange={(e) =>
          onChange({
            ...value,
            amount: Math.max(min, Number(e.target.value) || 0),
          })
        }
      />
      <select
        className={UI.inputAuto}
        value={value.unit}
        onChange={(e) =>
          onChange({ ...value, unit: e.target.value as DurationUnit })
        }
      >
        {UNITS.map((unit) => (
          <option key={unit} value={unit}>
            {DURATION_UNIT_LABELS[unit]}
          </option>
        ))}
      </select>
    </span>
  );
}

function assigneeValue(a: ProcessAssignee): string {
  return a.type === "appointment_master" ? "appointment_master" : `member:${a.memberId}`;
}

function parseAssignee(value: string): ProcessAssignee {
  if (value === "appointment_master") return { type: "appointment_master" };
  return { type: "member", memberId: value.startsWith("member:") ? value.slice(7) : "" };
}

export function ProcessEditor({
  initial,
  members,
  onCancel,
  onSaved,
}: {
  initial: BusinessProcessRow | null;
  members: ProcessTeamMember[];
  onCancel: () => void;
  onSaved: (process: BusinessProcessRow) => void;
}) {
  const [kind, setKind] = useState<ProcessKind>(initial?.kind ?? "task_report");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? false);
  const [config, setConfig] = useState<BusinessProcessConfig>(
    initial?.config ?? defaultProcessConfig("task_report"),
  );
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const tint = KIND_TINT[kind];
  const patch = (next: Partial<BusinessProcessConfig>) =>
    setConfig((c) => ({ ...c, ...next }));
  const trigger = config.trigger;

  function changeKind(next: ProcessKind) {
    setKind(next);
    // Новий тип — свіжі налаштування за замовчуванням, але люди лишаються.
    setConfig((c) => ({
      ...defaultProcessConfig(next),
      assignee: c.assignee,
      controllerIds: c.controllerIds,
    }));
  }

  function setTrigger(next: ProcessTrigger) {
    setConfig((c) => {
      // «Майстер запису» не має сенсу для розкладу чи події без запису.
      const masterOk =
        next.type === "event" && EVENTS_WITH_MASTER.includes(next.event);
      const assignee: ProcessAssignee =
        c.assignee.type === "appointment_master" && !masterOk
          ? { type: "member", memberId: "" }
          : c.assignee;
      return { ...c, trigger: next, assignee };
    });
  }

  function updateField(id: string, next: Partial<ProcessField>) {
    patch({
      fields: config.fields.map((f) => (f.id === id ? { ...f, ...next } : f)),
    });
  }

  function moveField(index: number, delta: number) {
    const fields = [...config.fields];
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    [fields[index], fields[target]] = [fields[target], fields[index]];
    patch({ fields });
  }

  const masterAllowed =
    trigger.type === "event" && EVENTS_WITH_MASTER.includes(trigger.event);
  const assigneeWithoutTelegram = useMemo(() => {
    const a = config.assignee;
    return a.type === "member" ? members.filter((m) => m.id === a.memberId && !m.hasTelegram) : [];
  }, [config.assignee, members]);

  const preview = useMemo(
    () =>
      Object.entries(PREVIEW_VALUES).reduce(
        (text, [key, value]) => text.split(key).join(value),
        config.messageTemplate,
      ),
    [config.messageTemplate],
  );

  async function save() {
    const normalized = normalizeProcessConfig(config, kind);
    const found = validateProcess({ title, kind, config: normalized });
    setErrors(found);
    if (found.length > 0) return;
    setBusy(true);
    try {
      const res = await fetch(
        initial
          ? `/api/admin/business-processes/${initial.id}`
          : "/api/admin/business-processes",
        {
          method: initial ? "PUT" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            kind,
            isActive,
            config: normalized,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не збережено");
      onSaved(json.process);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Помилка збереження"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${UI.card} mx-auto max-w-3xl overflow-hidden`}>
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
        style={{ background: tint }}
      >
        <div className="inline-flex gap-1 rounded-xl bg-white/50 p-0.5">
          {PROCESS_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              disabled={Boolean(initial) && k !== kind}
              className={segment(kind === k)}
              onClick={() => changeKind(k)}
            >
              {PROCESS_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={isActive}
            onChange={setIsActive}
            label={isActive ? "Увімкнено" : "Вимкнено"}
          />
          <button
            type="button"
            className={UI.headerButton}
            onClick={onCancel}
            disabled={busy}
          >
            ← До списку
          </button>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <p className={UI.hint}>
          {kind === "task_report"
            ? "Бот проводить виконавця по питаннях звіту: кнопки, так/ні, число, текст, фото чи відео."
            : "Бот надсилає адміністратору готовий текст для клієнта, посилання на його Instagram і картку в Kresco, кнопки «Надіслано» і «Не вдалося»."}
          {initial &&
            ` Тип після створення не змінюється. Зараз версія ${initial.version}; зміни налаштувань створять нову.`}
        </p>

        <Block title="Процес">
          <Row label="Назва">
            <input
              className={`${UI.inputAuto} w-full max-w-md`}
              placeholder="Напр. Фото роботи після візиту"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Row>
          <Row label="Домовленість" top>
            <textarea
              className={`${UI.textarea} max-w-md`}
              rows={2}
              placeholder="Що вирішили на нараді — необов'язково"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Row>
        </Block>

        <Block title="Коли запускати" hint="час — за Києвом">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-700">
            <div className={segmentWrap}>
              <button
                type="button"
                className={segment(trigger.type === "event")}
                onClick={() =>
                  trigger.type !== "event" &&
                  setTrigger(defaultProcessConfig(kind).trigger)
                }
              >
                Від події
              </button>
              <button
                type="button"
                disabled={kind === "client_message"}
                className={segment(trigger.type === "schedule")}
                onClick={() =>
                  trigger.type !== "schedule" &&
                  setTrigger({
                    type: "schedule",
                    frequency: "daily",
                    weekdays: [],
                    monthDays: [],
                    time: "10:00",
                  })
                }
              >
                За розкладом
              </button>
            </div>

            {trigger.type === "event" ? (
              <>
                <select
                  className={UI.inputAuto}
                  value={trigger.event}
                  onChange={(e) => {
                    const event = e.target.value as ProcessEvent;
                    setTrigger({
                      ...trigger,
                      event,
                      direction: EVENTS_WITH_BEFORE.includes(event)
                        ? trigger.direction
                        : "after",
                    });
                  }}
                >
                  {PROCESS_EVENTS.map((event) => (
                    <option key={event} value={event}>
                      {PROCESS_EVENT_LABELS[event]}
                    </option>
                  ))}
                </select>
                {EVENTS_WITH_BEFORE.includes(trigger.event) ? (
                  <select
                    className={UI.inputAuto}
                    value={trigger.direction}
                    onChange={(e) =>
                      setTrigger({
                        ...trigger,
                        direction: e.target.value as "after" | "before",
                      })
                    }
                  >
                    <option value="after">через</option>
                    <option value="before">за</option>
                  </select>
                ) : (
                  <span>через</span>
                )}
                <DurationInput
                  value={trigger.offset}
                  onChange={(offset) =>
                    setTrigger({
                      ...trigger,
                      offset,
                      atTime:
                        offset.unit === "days"
                          ? (trigger.atTime ?? "10:00")
                          : null,
                    })
                  }
                />
                {trigger.offset.unit === "days" && (
                  <>
                    <span>о</span>
                    <input
                      type="time"
                      className={UI.inputAuto}
                      value={trigger.atTime ?? "10:00"}
                      onChange={(e) =>
                        setTrigger({ ...trigger, atTime: e.target.value })
                      }
                    />
                  </>
                )}
                {trigger.offset.amount === 0 && (
                  <span className={UI.hint}>(одразу)</span>
                )}
              </>
            ) : (
              <>
                <div className={segmentWrap}>
                  {(["daily", "weekly", "monthly"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={segment(trigger.frequency === f)}
                      onClick={() => setTrigger({ ...trigger, frequency: f })}
                    >
                      {f === "daily"
                        ? "Щодня"
                        : f === "weekly"
                          ? "Щотижня"
                          : "Щомісяця"}
                    </button>
                  ))}
                </div>
                {trigger.frequency === "weekly" &&
                  WEEKDAYS.map((label, i) => {
                    const day = i + 1;
                    const on = trigger.weekdays.includes(day);
                    return (
                      <button
                        key={label}
                        type="button"
                        className={pill(on)}
                        onClick={() =>
                          setTrigger({
                            ...trigger,
                            weekdays: on
                              ? trigger.weekdays.filter((d) => d !== day)
                              : [...trigger.weekdays, day],
                          })
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                {trigger.frequency === "monthly" && (
                  <input
                    className={`${UI.inputAuto} w-24`}
                    placeholder="числа: 1, 15"
                    defaultValue={trigger.monthDays.join(", ")}
                    onBlur={(e) =>
                      setTrigger({
                        ...trigger,
                        monthDays: e.target.value
                          .split(/[,\s]+/)
                          .map(Number)
                          .filter((n) => n >= 1 && n <= 31),
                      })
                    }
                  />
                )}
                <span>о</span>
                <input
                  type="time"
                  className={UI.inputAuto}
                  value={trigger.time}
                  onChange={(e) =>
                    setTrigger({ ...trigger, time: e.target.value })
                  }
                />
              </>
            )}
          </div>
        </Block>

        <Block
          title="Хто виконує і хто контролює"
          hint="контролери отримують звіт і прострочене"
        >
          <Row label="Виконавець">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <select
                className={`${UI.inputAuto} min-w-[12rem]`}
                value={assigneeValue(config.assignee)}
                onChange={(e) =>
                  patch({ assignee: parseAssignee(e.target.value) })
                }
              >
                <option value="member:" disabled>
                  — оберіть людину —
                </option>
                <optgroup label="Команда">
                  {members.map((m) => (
                    <option key={m.id} value={`member:${m.id}`}>
                      {m.name}
                      {TEAM_ROLE_LABELS[m.role as TeamSalonRole] ? ` · ${TEAM_ROLE_LABELS[m.role as TeamSalonRole]}` : ""}
                    </option>
                  ))}
                </optgroup>
                {masterAllowed && (
                  <optgroup label="Учасник події">
                    <option value="appointment_master">Майстер запису</option>
                  </optgroup>
                )}
              </select>
              {assigneeWithoutTelegram.length > 0 && (
                <span className={UI.warn}>
                  Без Telegram:{" "}
                  {assigneeWithoutTelegram.map((m) => m.name).join(", ")} — бот
                  не зможе надіслати завдання.
                </span>
              )}
            </div>
          </Row>
          <Row label="Контролери" top>
            <div className="flex flex-wrap gap-1">
              {members.length === 0 && (
                <span className={UI.hint}>Команда ще не завантажилась</span>
              )}
              {members.map((m) => {
                const on = config.controllerIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={pill(on)}
                    onClick={() =>
                      patch({
                        controllerIds: on
                          ? config.controllerIds.filter((id) => id !== m.id)
                          : [...config.controllerIds, m.id],
                      })
                    }
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          </Row>
        </Block>

        {kind === "task_report" ? (
          <Block
            title="Звіт виконавця"
            hint="Бот питає по черзі. Фото й відео пересилаються контролеру, у Kresco зберігається лише посилання Telegram."
          >
            <div className="space-y-2">
              {config.fields.map((field, index) => (
                <FieldEditor
                  key={field.id}
                  index={index}
                  field={field}
                  total={config.fields.length}
                  onChange={(next) => updateField(field.id, next)}
                  onMove={(delta) => moveField(index, delta)}
                  onRemove={() =>
                    patch({
                      fields: config.fields.filter((f) => f.id !== field.id),
                    })
                  }
                />
              ))}
            </div>
            <button
              type="button"
              className={UI.addButton}
              disabled={config.fields.length >= 20}
              onClick={() =>
                patch({ fields: [...config.fields, emptyField("choice")] })
              }
            >
              + Питання
            </button>
          </Block>
        ) : (
          <Block
            title="Повідомлення клієнту"
            hint="Адміністратор скопіює текст і вставить у Direct клієнта."
          >
            <textarea
              className={`${UI.textarea} max-w-xl`}
              rows={3}
              placeholder="{ім'я}, нагадуємо: завтра {дата} о {час} чекаємо вас на {послуга} 💛"
              value={config.messageTemplate}
              onChange={(e) => patch({ messageTemplate: e.target.value })}
            />
            <div className="flex flex-wrap items-center gap-1">
              <span className={`${UI.hint} mr-1`}>Підставити:</span>
              {MESSAGE_PLACEHOLDERS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={pill(false)}
                  title={p.label}
                  onClick={() =>
                    patch({
                      messageTemplate: `${config.messageTemplate}${p.key}`,
                    })
                  }
                >
                  {p.key}
                </button>
              ))}
            </div>
            {config.messageTemplate.trim() && (
              <div>
                <div className={`${UI.hint} mb-1`}>
                  Так побачить адміністратор (приклад):
                </div>
                <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-gray-900">
                  {preview}
                </div>
              </div>
            )}
          </Block>
        )}

        <Block title="Строк і нагадування">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-gray-700">
            <span className="inline-flex items-center gap-1.5">
              <span>строк</span>
              <DurationInput
                min={1}
                value={config.deadline.due}
                onChange={(due) =>
                  patch({ deadline: { ...config.deadline, due } })
                }
              />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Switch
                checked={config.deadline.remindEvery != null}
                onChange={(on) =>
                  patch({
                    deadline: {
                      ...config.deadline,
                      remindEvery: on ? { amount: 2, unit: "hours" } : null,
                    },
                  })
                }
                label={
                  config.deadline.remindEvery
                    ? "нагадувати кожні"
                    : "повторно нагадувати"
                }
              />
              {config.deadline.remindEvery && (
                <DurationInput
                  min={1}
                  value={config.deadline.remindEvery}
                  onChange={(remindEvery) =>
                    patch({ deadline: { ...config.deadline, remindEvery } })
                  }
                />
              )}
            </span>
            <Switch
              checked={config.deadline.escalate}
              onChange={(escalate) =>
                patch({ deadline: { ...config.deadline, escalate } })
              }
              label="прострочене → контролерам"
            />
          </div>
        </Block>

        {errors.length > 0 && (
          <div className={UI.error}>
            {errors.map((e) => (
              <div key={e}>• {e}</div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            className={UI.plainButton}
            disabled={busy}
            onClick={onCancel}
          >
            Скасувати
          </button>
          <button
            type="button"
            className={UI.tintButton}
            style={{ background: tint }}
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Зберігаю…" : initial ? "Зберегти" : "Створити процес"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldEditor({
  index,
  field,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  field: ProcessField;
  total: number;
  onChange: (next: Partial<ProcessField>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const withOptions = field.type === "choice" || field.type === "multi_choice";
  const flags: {
    key: "required" | "toController" | "toHistory" | "toKpi";
    label: string;
  }[] = [
    { key: "required", label: "обов'язкове" },
    { key: "toController", label: "контролеру в Telegram" },
    { key: "toHistory", label: "в історію клієнта" },
    { key: "toKpi", label: "в KPI / дашборд" },
  ];
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#ebedf2] text-[11px] font-semibold text-gray-600">
          {index + 1}
        </span>
        <input
          className={`${UI.inputAuto} min-w-[12rem] flex-1`}
          placeholder="Текст питання, напр. «Фото роботи після»"
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <select
          className={UI.inputAuto}
          value={field.type}
          onChange={(e) => {
            const type = e.target.value as FieldType;
            const needsOptions = type === "choice" || type === "multi_choice";
            onChange({
              type,
              options:
                needsOptions && field.options.length < 2
                  ? ["", ""]
                  : field.options,
            });
          }}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <div className="flex">
          <button
            type="button"
            className={UI.iconButton}
            disabled={index === 0}
            onClick={() => onMove(-1)}
            title="Вище"
          >
            ↑
          </button>
          <button
            type="button"
            className={UI.iconButton}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            title="Нижче"
          >
            ↓
          </button>
          <button
            type="button"
            className={UI.iconDanger}
            onClick={onRemove}
            title="Прибрати питання"
          >
            ×
          </button>
        </div>
      </div>

      {withOptions && (
        <div className="space-y-1 pl-8">
          {field.options.map((option, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                className={`${UI.inputAuto} w-full max-w-xs`}
                placeholder={`Варіант ${i + 1}`}
                value={option}
                onChange={(e) =>
                  onChange({
                    options: field.options.map((o, j) =>
                      j === i ? e.target.value : o,
                    ),
                  })
                }
              />
              <button
                type="button"
                className={UI.iconButton}
                onClick={() =>
                  onChange({ options: field.options.filter((_, j) => j !== i) })
                }
                title="Прибрати варіант"
              >
                ×
              </button>
            </div>
          ))}
          {field.options.length < 12 && (
            <button
              type="button"
              className={UI.addButton}
              onClick={() => onChange({ options: [...field.options, ""] })}
            >
              + варіант
            </button>
          )}
        </div>
      )}

      {field.type === "media" && (
        <div className="flex flex-wrap items-center gap-1.5 pl-8 text-xs text-gray-700">
          <span>щонайменше</span>
          <input
            type="number"
            min={0}
            max={10}
            className={`${UI.inputAuto} w-14 text-center`}
            value={field.mediaMin}
            onChange={(e) =>
              onChange({
                mediaMin: Math.max(
                  0,
                  Math.min(10, Number(e.target.value) || 0),
                ),
              })
            }
          />
          <select
            className={UI.inputAuto}
            value={field.mediaKind}
            onChange={(e) =>
              onChange({
                mediaKind: e.target.value as ProcessField["mediaKind"],
              })
            }
          >
            <option value="photo">фото</option>
            <option value="video">відео</option>
            <option value="any">фото або відео</option>
          </select>
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 pl-8 text-[11px] text-gray-600">
        {flags.map((flag) => (
          <label
            key={flag.key}
            className="flex cursor-pointer items-center gap-1"
          >
            <input
              type="checkbox"
              className={UI.check}
              checked={field[flag.key]}
              onChange={(e) => onChange({ [flag.key]: e.target.checked })}
            />
            {flag.label}
          </label>
        ))}
      </div>
    </div>
  );
}
