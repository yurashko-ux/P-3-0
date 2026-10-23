// Середній час відповіді в Instagram: ніч 00:00–08:00 за Києвом не рахується.
// Якщо клієнт чекає вже реальні 24 години, відлік іде без викидання ночі.

const KYIV = "Europe/Kyiv";
const NIGHT_END_HOUR = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const REAL_WAIT_INCLUDES_NIGHT_MS = DAY_MS;

export type ReplyMessage = {
  direction: string;
  receivedAt: Date | string;
  /** manychat | instagram_graph | instagram_reaction | manual — для фільтра «надійних» вхідних. */
  source?: string | null;
};

/** Вхідні реакції (лайки) не стартують очікування; вихідні знімають його як будь-яка відповідь салону. */
const RELIABLE_REPLY_SOURCES = new Set(["instagram_graph", "manual"]);

export type ThreadReplyTime = {
  /** Середнє в хвилинах. null — ще не було жодної нашої відповіді на повідомлення клієнта. */
  replyAvgMinutes: number | null;
  /** Початок поточного очікування: перше повідомлення клієнта після нашої останньої відповіді. */
  waitingSince: string | null;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

type KyivParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function kyivParts(utcMs: number): KyivParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: KYIV,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Зсув Києва в мс на момент utcMs: локальний час мінус UTC. */
function kyivOffsetMs(utcMs: number): number {
  const p = kyivParts(utcMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - utcMs;
}

/** Київський календарний час → UTC. Друга ітерація зсуву тримає перехід літо/зима. */
export function kyivLocalToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = wall - kyivOffsetMs(wall);
  utc = wall - kyivOffsetMs(utc);
  return utc;
}

function startOfKyivDayUtc(utcMs: number): number {
  const p = kyivParts(utcMs);
  return kyivLocalToUtc(p.year, p.month, p.day, 0, 0, 0);
}

function nextKyivMidnightUtc(dayStartUtc: number): number {
  const p = kyivParts(dayStartUtc + 12 * 60 * 60 * 1000);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return kyivLocalToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0);
}

/** Мілісекунди між start і end без нічного вікна 00:00–08:00 Europe/Kyiv. */
export function businessReplyMs(startMs: number, endMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  let total = 0;
  let dayStart = startOfKyivDayUtc(startMs);
  let guard = 0;
  while (dayStart < endMs && guard < 4000) {
    const p = kyivParts(dayStart);
    const open = kyivLocalToUtc(p.year, p.month, p.day, NIGHT_END_HOUR, 0, 0);
    const nextMidnight = nextKyivMidnightUtc(dayStart);
    const windowStart = Math.max(startMs, open);
    const windowEnd = Math.min(endMs, nextMidnight);
    if (windowEnd > windowStart) total += windowEnd - windowStart;
    if (nextMidnight <= dayStart) break;
    dayStart = nextMidnight;
    guard += 1;
  }
  return total;
}

/** Відлік очікування: до реальних 24 год без ночі, далі — увесь час. */
export function waitingElapsedMs(waitingSinceMs: number, nowMs: number): number {
  if (!Number.isFinite(waitingSinceMs) || !Number.isFinite(nowMs) || nowMs <= waitingSinceMs) return 0;
  const real = nowMs - waitingSinceMs;
  if (real >= REAL_WAIT_INCLUDES_NIGHT_MS) return real;
  return businessReplyMs(waitingSinceMs, nowMs);
}

/**
 * гг:хх:сс; якщо повних годин ≥ 24 (вже без викидання ночі у waitingElapsedMs) —
 * кожні 24 год → 1 день: «1д. 00:59:59» з 24:59:59.
 */
export function formatWaitingClock(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const rest = totalSec % 86400;
  const hours = Math.floor(rest / 3600);
  const minutes = Math.floor((rest % 3600) / 60);
  const seconds = rest % 60;
  const clock = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  if (days <= 0) return clock;
  return `${days}д. ${clock}`;
}

/** Середній час відповіді для Переписок: «23 хв.», від 61 хв. — «1 год. 01 хв.». */
export function formatReplyAvgMinutes(minutes: number): string {
  const n = Math.max(0, Math.round(Number(minutes) || 0));
  if (n <= 60) return `${n} хв.`;
  const hours = Math.floor(n / 60);
  const rest = n % 60;
  return `${hours} год. ${String(rest).padStart(2, "0")} хв.`;
}

export function computeThreadReplyTime(messages: ReplyMessage[]): ThreadReplyTime {
  const sorted = messages
    .map((message) => ({
      direction: String(message.direction || "").trim().toLowerCase(),
      source: String(message.source || "manychat").trim().toLowerCase(),
      at: message.receivedAt instanceof Date ? message.receivedAt.getTime() : new Date(message.receivedAt).getTime(),
    }))
    .filter((message) => Number.isFinite(message.at))
    .sort((a, b) => a.at - b.at);

  const samples: number[] = [];
  let waitStart: number | null = null;
  for (const message of sorted) {
    if (message.direction === "incoming") {
      // ManyChat інколи дублює/плутає вхідні — для старту очікування лише Graph/manual.
      if (!RELIABLE_REPLY_SOURCES.has(message.source)) continue;
      if (waitStart == null) waitStart = message.at;
      continue;
    }
    if (message.direction === "outgoing") {
      // Вихідна відповідь або реакція салону знімає очікування (закриває розмову).
      if (waitStart != null) {
        if (RELIABLE_REPLY_SOURCES.has(message.source)) {
          samples.push(businessReplyMs(waitStart, message.at));
        }
        // Реакція салону теж закриває (samples не додаємо — це не текстова відповідь).
        waitStart = null;
      }
    }
  }

  // Страховка: останнє вихідне (текст Graph/manual або реакція салону) → не чекаємо.
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const message = sorted[i];
    const closesWait =
      RELIABLE_REPLY_SOURCES.has(message.source) || message.source === "instagram_reaction";
    if (!closesWait) continue;
    if (message.direction === "outgoing") waitStart = null;
    break;
  }

  const replyAvgMinutes =
    samples.length > 0 ? Math.round(samples.reduce((sum, ms) => sum + ms, 0) / samples.length / 60000) : null;

  return {
    replyAvgMinutes,
    waitingSince: waitStart != null ? new Date(waitStart).toISOString() : null,
  };
}
