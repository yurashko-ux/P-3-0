// Налаштування бізнес-процесу: що, коли, кому і як звітувати.
// Файл без серверних залежностей — ним користуються і сторінка конструктора, і API.

import { TEAM_SALON_ROLES, type TeamSalonRole } from "@/lib/team/constants";

export const PROCESS_KINDS = ["task_report", "client_message"] as const;
export type ProcessKind = (typeof PROCESS_KINDS)[number];

export const PROCESS_KIND_LABELS: Record<ProcessKind, string> = {
  task_report: "Завдання зі звітом",
  client_message: "Повідомлення клієнту",
};

export const TEAM_ROLE_LABELS: Record<TeamSalonRole, string> = {
  master: "Майстри",
  assistant: "Асистенти",
  admin: "Адміністратори",
  direct: "Direct",
  other: "Інші",
};

/** Події Kresco, від яких може стартувати процес. */
export const PROCESS_EVENTS = [
  "appointment_created",
  "appointment_start",
  "visit_done",
  "first_visit",
  "consultation_done",
  "checkout_paid",
  "lead_new",
] as const;
export type ProcessEvent = (typeof PROCESS_EVENTS)[number];

export const PROCESS_EVENT_LABELS: Record<ProcessEvent, string> = {
  appointment_created: "Запис створено",
  appointment_start: "Час запису",
  visit_done: "Візит відбувся",
  first_visit: "Перший візит клієнта",
  consultation_done: "Консультація відбулась",
  checkout_paid: "Чек оплачено",
  lead_new: "Новий лід",
};

/** «До події» має сенс лише для подій із відомим часом у майбутньому. */
export const EVENTS_WITH_BEFORE: ProcessEvent[] = ["appointment_start"];

/** Події, у яких є майстер запису — для виконавця «майстер запису». */
export const EVENTS_WITH_MASTER: ProcessEvent[] = [
  "appointment_created",
  "appointment_start",
  "visit_done",
  "first_visit",
  "consultation_done",
  "checkout_paid",
];

/** Події з клієнтом — для процесу «Повідомлення клієнту». */
export const EVENTS_WITH_CLIENT: ProcessEvent[] = [...PROCESS_EVENTS];

export type ProcessAssignee =
  | { type: "member"; memberId: string }
  | { type: "role"; role: TeamSalonRole }
  | { type: "appointment_master" };

export type DurationUnit = "minutes" | "hours" | "days";

export const DURATION_UNIT_LABELS: Record<DurationUnit, string> = {
  minutes: "хв",
  hours: "год",
  days: "дн.",
};

export type ProcessDuration = { amount: number; unit: DurationUnit };

export type ProcessTrigger =
  | {
      type: "event";
      event: ProcessEvent;
      direction: "after" | "before";
      /** 0 — одразу. */
      offset: ProcessDuration;
      /** Для зсуву в днях: о котрій годині (Київ), напр. «10:00». */
      atTime: string | null;
    }
  | {
      type: "schedule";
      frequency: "daily" | "weekly" | "monthly";
      /** 1 = пн … 7 = нд; для weekly. */
      weekdays: number[];
      /** 1…31; для monthly. Якщо в місяці менше днів — останній день. */
      monthDays: number[];
      time: string;
    };

export const FIELD_TYPES = ["choice", "multi_choice", "yes_no", "number", "text", "media"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  choice: "Кнопки: один варіант",
  multi_choice: "Кнопки: кілька варіантів",
  yes_no: "Так / ні",
  number: "Число",
  text: "Текст",
  media: "Фото / відео",
};

export type ProcessField = {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Для choice / multi_choice. */
  options: string[];
  /** Для media: мінімум файлів і що приймаємо. */
  mediaMin: number;
  mediaKind: "photo" | "video" | "any";
  /** Куди йде відповідь. */
  toController: boolean;
  toHistory: boolean;
  toKpi: boolean;
};

export type ProcessDeadline = {
  /** Строк від моменту видачі завдання. */
  due: ProcessDuration;
  /** Повторне нагадування до виконання; null — без повторів. */
  remindEvery: ProcessDuration | null;
  /** Прострочено — повідомити контролерів. */
  escalate: boolean;
};

export type BusinessProcessConfig = {
  assignee: ProcessAssignee;
  /** Кому йдуть звіти й прострочення (id людей з Команди). */
  controllerIds: string[];
  trigger: ProcessTrigger;
  /** Форма звіту — для task_report. */
  fields: ProcessField[];
  /** Шаблон повідомлення — для client_message. */
  messageTemplate: string;
  deadline: ProcessDeadline;
};

/** Підстановки в шаблоні повідомлення клієнту. */
export const MESSAGE_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "{ім'я}", label: "ім'я клієнта" },
  { key: "{дата}", label: "дата запису" },
  { key: "{час}", label: "час запису" },
  { key: "{майстер}", label: "майстер" },
  { key: "{послуга}", label: "послуга" },
];

export function newFieldId(): string {
  return `f_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyField(type: FieldType = "choice"): ProcessField {
  return {
    id: newFieldId(),
    label: "",
    type,
    required: true,
    options: type === "choice" || type === "multi_choice" ? ["", ""] : [],
    mediaMin: 1,
    mediaKind: "photo",
    toController: true,
    toHistory: false,
    toKpi: false,
  };
}

export function defaultProcessConfig(kind: ProcessKind = "task_report"): BusinessProcessConfig {
  return {
    assignee: { type: "role", role: "admin" },
    controllerIds: [],
    trigger:
      kind === "client_message"
        ? {
            type: "event",
            event: "appointment_start",
            direction: "before",
            offset: { amount: 1, unit: "days" },
            atTime: "10:00",
          }
        : {
            type: "event",
            event: "visit_done",
            direction: "after",
            offset: { amount: 0, unit: "minutes" },
            atTime: null,
          },
    fields: kind === "task_report" ? [emptyField("yes_no")] : [],
    messageTemplate: "",
    deadline: { due: { amount: 4, unit: "hours" }, remindEvery: { amount: 2, unit: "hours" }, escalate: true },
  };
}

// ---------- Перевірка й нормалізація (спільна для форми і сервера) ----------

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function str(v: unknown, max = 500): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return list.includes(v as T) ? (v as T) : fallback;
}

function duration(raw: unknown, fallback: ProcessDuration): ProcessDuration {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    amount: int(r.amount, 0, 365 * 24 * 60, fallback.amount),
    unit: oneOf(r.unit, ["minutes", "hours", "days"] as const, fallback.unit),
  };
}

function normalizeAssignee(raw: unknown): ProcessAssignee {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (r.type === "member") return { type: "member", memberId: str(r.memberId, 100) };
  if (r.type === "appointment_master") return { type: "appointment_master" };
  return { type: "role", role: oneOf(r.role, TEAM_SALON_ROLES, "admin") };
}

function normalizeTrigger(raw: unknown): ProcessTrigger {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (r.type === "schedule") {
    const frequency = oneOf(r.frequency, ["daily", "weekly", "monthly"] as const, "daily");
    const list = (v: unknown, min: number, max: number) =>
      [...new Set((Array.isArray(v) ? v : []).map((x) => int(x, min, max, 0)).filter((x) => x >= min))].sort(
        (a, b) => a - b,
      );
    return {
      type: "schedule",
      frequency,
      weekdays: frequency === "weekly" ? list(r.weekdays, 1, 7) : [],
      monthDays: frequency === "monthly" ? list(r.monthDays, 1, 31) : [],
      time: TIME_RE.test(str(r.time, 5)) ? str(r.time, 5) : "10:00",
    };
  }
  const event = oneOf(r.event, PROCESS_EVENTS, "visit_done");
  const direction = EVENTS_WITH_BEFORE.includes(event) && r.direction === "before" ? "before" : "after";
  const offset = duration(r.offset, { amount: 0, unit: "minutes" });
  const atTimeRaw = str(r.atTime, 5);
  return {
    type: "event",
    event,
    direction,
    offset,
    atTime: offset.unit === "days" && TIME_RE.test(atTimeRaw) ? atTimeRaw : null,
  };
}

function normalizeField(raw: unknown): ProcessField {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const type = oneOf(r.type, FIELD_TYPES, "text");
  const withOptions = type === "choice" || type === "multi_choice";
  return {
    id: str(r.id, 40) || newFieldId(),
    label: str(r.label, 200),
    type,
    required: r.required !== false,
    options: withOptions
      ? (Array.isArray(r.options) ? r.options : []).map((o) => str(o, 60)).filter(Boolean).slice(0, 12)
      : [],
    mediaMin: type === "media" ? int(r.mediaMin, 0, 10, 1) : 0,
    mediaKind: type === "media" ? oneOf(r.mediaKind, ["photo", "video", "any"] as const, "photo") : "photo",
    toController: r.toController !== false,
    toHistory: r.toHistory === true,
    toKpi: r.toKpi === true,
  };
}

export function normalizeProcessConfig(raw: unknown, kind: ProcessKind): BusinessProcessConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = (r.deadline && typeof r.deadline === "object" ? r.deadline : {}) as Record<string, unknown>;
  return {
    assignee: normalizeAssignee(r.assignee),
    controllerIds: [...new Set((Array.isArray(r.controllerIds) ? r.controllerIds : []).map((x) => str(x, 100)).filter(Boolean))],
    trigger: normalizeTrigger(r.trigger),
    fields: kind === "task_report" ? (Array.isArray(r.fields) ? r.fields : []).slice(0, 20).map(normalizeField) : [],
    messageTemplate: kind === "client_message" ? str(r.messageTemplate, 2000) : "",
    deadline: {
      due: duration(d.due, { amount: 4, unit: "hours" }),
      remindEvery: d.remindEvery ? duration(d.remindEvery, { amount: 2, unit: "hours" }) : null,
      escalate: d.escalate !== false,
    },
  };
}

/** Помилки, через які процес не можна зберегти. Порожній список — усе гаразд. */
export function validateProcess(input: {
  title: string;
  kind: ProcessKind;
  config: BusinessProcessConfig;
}): string[] {
  const errors: string[] = [];
  const { config } = input;
  if (!input.title.trim()) errors.push("Вкажіть назву процесу");
  if (config.assignee.type === "member" && !config.assignee.memberId) errors.push("Оберіть виконавця");
  if (config.assignee.type === "appointment_master") {
    if (config.trigger.type !== "event" || !EVENTS_WITH_MASTER.includes(config.trigger.event)) {
      errors.push("«Майстер запису» можна обрати лише для подій із записом");
    }
  }
  if (config.trigger.type === "schedule") {
    if (config.trigger.frequency === "weekly" && config.trigger.weekdays.length === 0) {
      errors.push("Оберіть дні тижня для запуску");
    }
    if (config.trigger.frequency === "monthly" && config.trigger.monthDays.length === 0) {
      errors.push("Оберіть числа місяця для запуску");
    }
  }
  if (input.kind === "client_message") {
    if (config.trigger.type !== "event") errors.push("Повідомлення клієнту запускається лише від події з клієнтом");
    if (!config.messageTemplate.trim()) errors.push("Напишіть текст повідомлення клієнту");
  }
  if (input.kind === "task_report") {
    if (config.fields.length === 0) errors.push("Додайте хоча б одне питання у звіт");
    config.fields.forEach((field, index) => {
      const n = index + 1;
      if (!field.label) errors.push(`Питання ${n}: вкажіть текст`);
      if ((field.type === "choice" || field.type === "multi_choice") && field.options.length < 2) {
        errors.push(`Питання ${n}: потрібно щонайменше два варіанти`);
      }
    });
  }
  if (!(config.deadline.due.amount > 0)) errors.push("Вкажіть строк виконання");
  return errors;
}

// ---------- Опис людською мовою (для списку процесів) ----------

function durationText(d: ProcessDuration): string {
  return `${d.amount} ${DURATION_UNIT_LABELS[d.unit]}`;
}

const WEEKDAY_SHORT = ["", "пн", "вт", "ср", "чт", "пт", "сб", "нд"];

export function describeTrigger(trigger: ProcessTrigger): string {
  if (trigger.type === "schedule") {
    if (trigger.frequency === "daily") return `Щодня о ${trigger.time}`;
    if (trigger.frequency === "weekly") {
      return `Щотижня (${trigger.weekdays.map((d) => WEEKDAY_SHORT[d]).join(", ") || "—"}) о ${trigger.time}`;
    }
    return `Щомісяця ${trigger.monthDays.join(", ") || "—"} числа о ${trigger.time}`;
  }
  const event = PROCESS_EVENT_LABELS[trigger.event].toLowerCase();
  if (trigger.offset.amount === 0) return `Одразу: ${event}`;
  const at = trigger.atTime ? ` о ${trigger.atTime}` : "";
  return `${trigger.direction === "before" ? "За" : "Через"} ${durationText(trigger.offset)}${at} ${
    trigger.direction === "before" ? "до" : "після"
  }: ${event}`;
}

export function describeAssignee(
  assignee: ProcessAssignee,
  memberName: (id: string) => string | undefined,
): string {
  if (assignee.type === "member") return memberName(assignee.memberId) || "людина не знайдена";
  if (assignee.type === "appointment_master") return "Майстер запису";
  return `${TEAM_ROLE_LABELS[assignee.role]} (закриває перший)`;
}

export function describeDeadline(deadline: ProcessDeadline): string {
  const bits = [`строк ${durationText(deadline.due)}`];
  if (deadline.remindEvery) bits.push(`нагадувати кожні ${durationText(deadline.remindEvery)}`);
  if (deadline.escalate) bits.push("прострочене — контролерам");
  return bits.join(" · ");
}
