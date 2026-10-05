// Доставка маркетингового звіту лише в групу агенції. Повний операційний звіт сюди не йде.

import { getAllDirectClients } from "@/lib/direct-store";
import { kvRead, kvWrite } from "@/lib/kv";
import { sendMessage } from "@/lib/telegram/api";
import { TELEGRAM_ENV, assertReportsBotToken } from "@/lib/telegram/env";
import {
  buildMarketingReport,
  formatMarketingReportTelegram,
  marketingPeriodsForRunDay,
  type MarketingReportKind,
} from "@/lib/reports/marketing";

const MARKETING_SEND_MINUTES = 9 * 60;
const LAST_RUN_PREFIX = "reports:marketing:last-run:";

type LastRun = { runKyivDay: string; ok: boolean; at: string };

export type MarketingDeliveryItem = {
  kind: MarketingReportKind;
  from: string;
  to: string;
  ok: boolean;
  skipped?: string;
  error?: string;
};

export type MarketingDeliveryResult = {
  ok: boolean;
  skipped?: string;
  chatId: number | null;
  items: MarketingDeliveryItem[];
};

async function readLastRun(kind: MarketingReportKind): Promise<LastRun | null> {
  const raw = await kvRead.getRaw(`${LAST_RUN_PREFIX}${kind}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastRun;
  } catch {
    return null;
  }
}

async function writeLastRun(kind: MarketingReportKind, payload: LastRun) {
  await kvWrite.setRaw(`${LAST_RUN_PREFIX}${kind}`, JSON.stringify(payload));
}

export async function deliverDueMarketingReports(options: {
  runKyivDay: string;
  nowMinutes: number;
  force?: boolean;
}): Promise<MarketingDeliveryResult> {
  const chatId = TELEGRAM_ENV.MARKETING_GROUP_CHAT_ID;
  const due = options.force || options.nowMinutes >= MARKETING_SEND_MINUTES;
  if (!due) {
    return { ok: true, skipped: "not-time", chatId, items: [] };
  }
  if (chatId == null) {
    const logKey = "reports:marketing:no-chat-logged";
    const loggedDay = await kvRead.getRaw(logKey);
    if (loggedDay !== options.runKyivDay) {
      console.log(
        "[reports/marketing] Немає TELEGRAM_MARKETING_GROUP_CHAT_ID — у групу нічого не шлемо",
      );
      await kvWrite.setRaw(logKey, options.runKyivDay);
    }
    return { ok: true, skipped: "no-chat", chatId: null, items: [] };
  }

  assertReportsBotToken();
  const periods = marketingPeriodsForRunDay(options.runKyivDay);
  const pending = [];
  for (const period of periods) {
    const last = await readLastRun(period.kind);
    if (!options.force && last?.ok && last.runKyivDay === options.runKyivDay) continue;
    pending.push(period);
  }
  if (pending.length === 0) {
    return { ok: true, skipped: "already-sent", chatId, items: [] };
  }

  const clients = await getAllDirectClients();
  const items: MarketingDeliveryItem[] = [];
  for (const period of pending) {
    try {
      const data = await buildMarketingReport(period.kind, period.from, period.to, clients);
      const text = formatMarketingReportTelegram(data);
      await sendMessage(
        chatId,
        text,
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
        TELEGRAM_ENV.REPORTS_BOT_TOKEN,
      );
      await writeLastRun(period.kind, {
        runKyivDay: options.runKyivDay,
        ok: true,
        at: new Date().toISOString(),
      });
      console.log("[reports/marketing] Надіслано", {
        kind: period.kind,
        from: period.from,
        to: period.to,
        chatId,
        leads: data.leads,
      });
      items.push({ kind: period.kind, from: period.from, to: period.to, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[reports/marketing] Помилка відправки", {
        kind: period.kind,
        chatId,
        error: message,
      });
      items.push({
        kind: period.kind,
        from: period.from,
        to: period.to,
        ok: false,
        error: message,
      });
    }
  }

  return {
    ok: items.every((item) => item.ok),
    chatId,
    items,
  };
}

/** Тест з адмінки: денний звіт за день у групу. Не чіпає ключ «вже відправлено» крона. */
export async function sendMarketingDayReport(kyivDay: string): Promise<{
  kyivDay: string;
  chatId: number;
  text: string;
  leads: number;
  consultationsCreated: number;
  consultationsAttended: number;
  consultationsNoShow: number;
  paidRecordsCreated: number;
}> {
  const chatId = TELEGRAM_ENV.MARKETING_GROUP_CHAT_ID;
  if (chatId == null) {
    throw new Error("Не задано TELEGRAM_MARKETING_GROUP_CHAT_ID");
  }
  assertReportsBotToken();
  const data = await buildMarketingReport("day", kyivDay, kyivDay);
  const text = formatMarketingReportTelegram(data);
  await sendMessage(
    chatId,
    text,
    { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    TELEGRAM_ENV.REPORTS_BOT_TOKEN,
  );
  console.log("[reports/marketing] Тестова відправка денного звіту", {
    kyivDay,
    chatId,
    leads: data.leads,
    consultationsCreated: data.consultationsCreated,
    consultationsAttended: data.consultationsAttended,
    consultationsNoShow: data.consultationsNoShow,
    paidRecordsCreated: data.paidRecordsCreated,
  });
  return {
    kyivDay,
    chatId,
    text,
    leads: data.leads,
    consultationsCreated: data.consultationsCreated,
    consultationsAttended: data.consultationsAttended,
    consultationsNoShow: data.consultationsNoShow,
    paidRecordsCreated: data.paidRecordsCreated,
  };
}
