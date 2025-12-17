import { AppointmentReminder, MasterProfile } from "./types";

export const MOCK_MASTERS: MasterProfile[] = [
  {
    id: "master-test",
    name: "Тестовий майстер (Mykolay)",
    telegramUsername: "Mykolay007",
    role: "master",
    // altegioStaffId: 123, // TODO: Додайте реальний staff_id з Altegio
  },
  {
    id: "master-olena",
    name: "Олена",
    telegramUsername: "o_sarbeeva",
    role: "master",
    altegioStaffId: 2658785,
  },
  {
    id: "master-tester",
    name: "Mykolay (тест-режим)",
    telegramUsername: "Mykolay007",
    role: "master",
    // altegioStaffId: 123, // TODO: Додайте реальний staff_id з Altegio
  },
  {
    id: "master-oleksandra",
    name: "Олександра",
    telegramUsername: "Alexandra_Z7",
    role: "master",
    altegioStaffId: 2851361,
  },
  {
    id: "master-maryana",
    name: "Мар'яна",
    telegramUsername: "maryana24021989",
    role: "master",
    altegioStaffId: 2860168,
  },
  {
    id: "master-halyna",
    name: "Галина",
    telegramUsername: "Halyna_Maxymiv",
    role: "master",
    altegioStaffId: 2658783,
  },
  {
    id: "admin-viktoria",
    name: "Вікторія (адміністратор)",
    telegramUsername: "kolachnykv",
    role: "admin",
    altegioStaffId: 2643393,
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
  {
    id: "apt-1004",
    clientName: "Тестовий клієнт",
    serviceName: "Нарощення волосся (тест)",
    masterId: "master-test",
    masterName: "Тестовий майстер (Mykolay)",
    startAt: addMinutes(now, -10),
    endAt: addMinutes(now, 15),
  },
];

