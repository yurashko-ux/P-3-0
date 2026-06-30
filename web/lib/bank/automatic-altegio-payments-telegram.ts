import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/telegram/api";
import { TELEGRAM_ENV, assertPaymentsBotToken } from "@/lib/telegram/env";

const PAYMENT_RECONCILIATION_TEST_USERNAME = "mykolay";

export type AutomaticPaymentTelegramKind = "acquiring_commission" | "terminal_fee";

export type AutomaticPaymentTelegramReport = {
  kind: AutomaticPaymentTelegramKind;
  accountTitle: string;
  amountKopiykas: bigint;
  comment: string | null;
  altegioTransactionId: number | null;
  bankStatementItemId?: string | null;
  kyivMonth?: string | null;
  reusedExisting?: boolean;
  errorMessage?: string | null;
};

function formatMoneyUah(kop: bigint): string {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(kop) / 100);
}

function kindLabel(kind: AutomaticPaymentTelegramKind): string {
  if (kind === "acquiring_commission") return "Комісія за еквайринг";
  return "Комісія за РКО (термінал)";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildAutomaticPaymentTelegramText(report: AutomaticPaymentTelegramReport): string {
  const lines = [
    "🤖 <b>Автоматичний платіж Altegio</b>",
    "",
    `Тип: <b>${escapeHtml(kindLabel(report.kind))}</b>`,
    `Рахунок: ${escapeHtml(report.accountTitle)}`,
    `Сума: <b>${formatMoneyUah(report.amountKopiykas)} ₴</b>`,
  ];

  if (report.kyivMonth) {
    lines.push(`Місяць: ${escapeHtml(report.kyivMonth)}`);
  }
  if (report.altegioTransactionId) {
    lines.push(`Altegio ID: <code>${report.altegioTransactionId}</code>`);
  }
  if (report.comment) {
    lines.push(`Коментар: ${escapeHtml(report.comment)}`);
  }
  if (report.reusedExisting) {
    lines.push("", "ℹ️ Використано існуючу операцію в Altegio");
  }
  if (report.errorMessage) {
    lines.push("", `❌ Помилка: ${escapeHtml(report.errorMessage)}`);
  }

  return lines.join("\n");
}

async function getAutomaticPaymentTelegramChatIds(): Promise<number[]> {
  if (TELEGRAM_ENV.PAYMENTS_ADMIN_CHAT_IDS.length > 0) {
    return [...new Set(TELEGRAM_ENV.PAYMENTS_ADMIN_CHAT_IDS)];
  }

  const masters = await prisma.directMaster.findMany({
    where: { isActive: true },
    select: {
      name: true,
      telegramUsername: true,
      telegramChatId: true,
    },
  });

  const mykolay = masters.find((master) => {
    const username = String(master.telegramUsername || "").trim().replace(/^@/, "").toLowerCase();
    const name = String(master.name || "").trim().toLowerCase();
    return username === PAYMENT_RECONCILIATION_TEST_USERNAME || name.includes("mykolay") || name.includes("миколай");
  });

  if (!mykolay?.telegramChatId) return [];
  const chatId = Number(mykolay.telegramChatId);
  return Number.isFinite(chatId) ? [chatId] : [];
}

/** Звіт у Telegram про автоматичний платіж (без інтерактивного зведення). */
export async function sendAutomaticAltegioPaymentTelegramReport(
  report: AutomaticPaymentTelegramReport,
): Promise<{ sent: number; chatIds: number[] }> {
  const chatIds = await getAutomaticPaymentTelegramChatIds();
  if (chatIds.length === 0) {
    console.warn("[automatic-altegio-payments-telegram] Немає chatId для звіту", {
      kind: report.kind,
      accountTitle: report.accountTitle,
    });
    return { sent: 0, chatIds: [] };
  }

  assertPaymentsBotToken();
  const text = buildAutomaticPaymentTelegramText(report);
  let sent = 0;

  for (const chatId of chatIds) {
    try {
      await sendMessage(chatId, text, {}, TELEGRAM_ENV.PAYMENTS_BOT_TOKEN);
      sent += 1;
    } catch (error) {
      console.error("[automatic-altegio-payments-telegram] Помилка відправки", {
        chatId,
        kind: report.kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log("[automatic-altegio-payments-telegram] Звіт відправлено", {
    kind: report.kind,
    accountTitle: report.accountTitle,
    sent,
    chatIds,
  });

  return { sent, chatIds };
}
