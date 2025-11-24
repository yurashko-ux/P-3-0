import { AppointmentReminder, MasterProfile } from "./types";

export const MOCK_MASTERS: MasterProfile[] = [
  {
    id: "master-olena",
    name: "Олена",
    telegramUsername: "o_sarbeeva",
    role: "master",
  },
  {
    id: "master-oleksandra",
    name: "Олександра",
    telegramUsername: "Alexandra_Z7",
    role: "master",
  },
  {
    id: "master-maryana",
    name: "Мар'яна",
    telegramUsername: "maryana24021989",
    role: "master",
  },
  {
    id: "master-halyna",
    name: "Галина",
    telegramUsername: undefined,
    role: "master",
  },
  {
    id: "admin-viktoria",
    name: "Вікторія (адміністратор)",
    telegramUsername: "kolachnykv",
    role: "admin",
  },
];

const now = new Date();

function addMinutes(date: Date, minutes: number) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() + minutes);
  return copy.toISOString();
}

export const MOCK_APPOINTMENTS: AppointmentReminder[] = [
  {
    id: "apt-1001",
    clientName: "Ірина",
    serviceName: "Нарощення волосся (повне)",
    masterId: "master-olena",
    masterName: "Олена",
    startAt: addMinutes(now, -60),
    endAt: addMinutes(now, -5),
  },
  {
    id: "apt-1002",
    clientName: "Марія",
    serviceName: "Корекція нарощення",
    masterId: "master-oleksandra",
    masterName: "Олександра",
    startAt: addMinutes(now, -30),
    endAt: addMinutes(now, 10),
  },
  {
    id: "apt-1003",
    clientName: "Оксана",
    serviceName: "Полірування та укладка",
    masterId: "master-maryana",
    masterName: "Мар'яна",
    startAt: addMinutes(now, -20),
    endAt: addMinutes(now, 20),
  },
];

