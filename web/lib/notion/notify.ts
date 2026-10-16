import { kvWrite } from "@/lib/kv";
import { sendMessage } from "@/lib/telegram/api";
import { getNotionTelegramBotToken } from "./env";

const OUTGOING_KEY = "notion:telegram:outgoing";

export async function sendNotionTelegram(chatId: bigint, text: string) {
  const token = getNotionTelegramBotToken();
  if (!token) {
    throw new Error("TELEGRAM_NOTION_BOT_TOKEN не задано");
  }
  const chat = chatId.toString();
  await sendMessage(chat, text, {}, token);
  try {
    await kvWrite.lpush(
      OUTGOING_KEY,
      JSON.stringify({
        sentAt: new Date().toISOString(),
        chatId: chat,
        text,
        source: "notion",
      }),
    );
    await kvWrite.ltrim(OUTGOING_KEY, 0, 499);
  } catch (error) {
    console.error("[notion] не вдалося залогувати вихідне Telegram-повідомлення", error);
  }
}

export async function logNotionWebhook(entry: Record<string, unknown>) {
  try {
    await kvWrite.lpush(
      "notion:webhook:log",
      JSON.stringify({ at: new Date().toISOString(), ...entry }),
    );
    await kvWrite.ltrim("notion:webhook:log", 0, 199);
  } catch (error) {
    console.error("[notion] не вдалося залогувати вебхук", error);
  }
}
