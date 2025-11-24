import { kv } from "@vercel/kv";
import { findMasterById, findMasterByUsername, getMasters } from "./service";
import { MasterProfile } from "./types";

const CHAT_INDEX_KEY = "photo-reports:telegram:chats";

type ChatRegistryEntry = {
  masterId: string;
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  registeredAt: string;
};

export async function registerChatForMaster(
  chatId: number,
  username?: string,
  firstName?: string,
  lastName?: string
) {
  const master =
    findMasterByUsername(username) || detectMasterByName(firstName, lastName);

  if (!master) {
    console.warn(
      "[photo-report] Unknown master tried to register",
      chatId,
      username
    );
    return null;
  }

  const entry: ChatRegistryEntry = {
    masterId: master.id,
    chatId,
    username,
    firstName,
    lastName,
    registeredAt: new Date().toISOString(),
  };

  await kv.hset(CHAT_INDEX_KEY, { [chatId]: entry });
  return { master, entry };
}

export async function getRegisteredMasterByChatId(chatId: number) {
  const entry = await kv.hget<ChatRegistryEntry>(CHAT_INDEX_KEY, String(chatId));
  if (!entry) return null;
  const master = findMasterById(entry.masterId);
  if (!master) return null;
  return { master, entry };
}

export async function listRegisteredChats() {
  const all = await kv.hgetall<ChatRegistryEntry>(CHAT_INDEX_KEY);
  return all ? Object.values(all) : [];
}

export async function getChatIdForMaster(masterId: string) {
  const entries = await listRegisteredChats();
  const match = entries.find((entry) => entry.masterId === masterId);
  return match?.chatId;
}

function detectMasterByName(firstName?: string, lastName?: string) {
  if (!firstName) return undefined;
  const normalized = [firstName, lastName].filter(Boolean).join(" ").toLowerCase();
  return getMasters().find((master) =>
    master.name.toLowerCase().includes(firstName.toLowerCase()) ||
    (lastName ? master.name.toLowerCase().includes(lastName.toLowerCase()) : false) ||
    master.name.toLowerCase() === normalized
  );
}

