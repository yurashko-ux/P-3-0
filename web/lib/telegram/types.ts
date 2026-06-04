export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
  /** Повідомлення від імені Business (вихідне через бота або салон). */
  business_connection_id?: string;
  sender_business_bot?: TelegramUser;
  photo?: Array<{
    file_id: string;
    width: number;
    height: number;
    file_unique_id: string;
  }>;
  caption?: string;
  reply_to_message?: TelegramMessage;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

export type TelegramBusinessConnection = {
  id: string;
  user: TelegramUser;
  user_chat_id: number;
  date: number;
  is_enabled?: boolean;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  business_connection?: TelegramBusinessConnection;
  business_message?: TelegramMessage & { business_connection_id?: string };
  edited_business_message?: TelegramMessage & { business_connection_id?: string };
};

