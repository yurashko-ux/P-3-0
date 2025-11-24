export type MasterRole = "master" | "admin";

export type MasterProfile = {
  id: string;
  name: string;
  telegramUsername?: string;
  telegramChatId?: number;
  role: MasterRole;
};

export type AppointmentReminder = {
  id: string;
  clientName: string;
  serviceName: string;
  masterId: string;
  masterName: string;
  startAt: string;
  endAt: string;
};

export type PhotoReport = {
  id: string;
  appointmentId: string;
  masterId: string;
  masterName: string;
  clientName: string;
  serviceName: string;
  createdAt: string;
  telegramFileId: string; // Перше фото (для сумісності)
  telegramFileIds: string[]; // Всі фото
  telegramMessageId?: number;
  caption?: string;
};

