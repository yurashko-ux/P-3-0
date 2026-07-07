// Доставка щоденного звіту в Telegram.

import { sendMessage } from "@/lib/telegram/api";
import { TELEGRAM_ENV, assertReportsBotToken } from "@/lib/telegram/env";
import { kvWrite } from "@/lib/kv";
import { buildDailyOpsReport } from "@/lib/reports/daily-ops";
import { formatDailyReportTelegram } from "@/lib/reports/format-telegram";
import { getDailyReportRecipientChatIds } from "@/lib/reports/recipients";

export type DeliverDailyReportResult = {
  ok: boolean;
  kyivDay: string;
  text: string;
  recipientCount: number;
  sent: number;
  failed: number;
  errors: string[];
};

async function logOutgoing(payload: object) {
  try {
    await kvWrite.lpush(
      "reports:telegram:outgoing",
      JSON.stringify({ at: new Date().toISOString(), ...payload }),
    );
    await kvWrite.ltrim("reports:telegram:outgoing", 0, 199);
  } catch (err) {
    console.warn("[reports/delivery] KV log failed:", err);
  }
}

export async function deliverDailyReport(options?: {
  kyivDay?: string | null;
  chatIds?: number[];
}): Promise<DeliverDailyReportResult> {
  assertReportsBotToken();
  const botToken = TELEGRAM_ENV.REPORTS_BOT_TOKEN;

  const data = await buildDailyOpsReport({ kyivDay: options?.kyivDay });
  const text = formatDailyReportTelegram(data);

  const chatIds =
    options?.chatIds && options.chatIds.length > 0
      ? [...new Set(options.chatIds)]
      : await getDailyReportRecipientChatIds();

  const result: DeliverDailyReportResult = {
    ok: true,
    kyivDay: data.kyivDay,
    text,
    recipientCount: chatIds.length,
    sent: 0,
    failed: 0,
    errors: [],
  };

  if (chatIds.length === 0) {
    result.ok = false;
    result.errors.push("Немає отримувачів з прив'язаним telegramChatId. Надішліть /start боту @ZVITY_HoB_bot");
    return result;
  }

  for (const chatId of chatIds) {
    try {
      await sendMessage(chatId, text, { parse_mode: "HTML" }, botToken);
      result.sent += 1;
      await logOutgoing({
        event: "daily_report_sent",
        kyivDay: data.kyivDay,
        chatId,
        ok: true,
      });
    } catch (err) {
      result.failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`chat ${chatId}: ${msg}`);
      await logOutgoing({
        event: "daily_report_sent",
        kyivDay: data.kyivDay,
        chatId,
        ok: false,
        error: msg,
      });
    }
  }

  result.ok = result.failed === 0;
  return result;
}

export async function previewDailyReportText(options?: {
  kyivDay?: string | null;
}): Promise<{ kyivDay: string; text: string }> {
  const data = await buildDailyOpsReport({ kyivDay: options?.kyivDay });
  return { kyivDay: data.kyivDay, text: formatDailyReportTelegram(data) };
}
