import { MOCK_APPOINTMENTS, MOCK_MASTERS } from "./mock-data";
import { AppointmentReminder, MasterProfile } from "./types";

export function getMasters(): MasterProfile[] {
  return MOCK_MASTERS;
}

export function findMasterByUsername(username?: string | null) {
  if (!username) return undefined;
  return MOCK_MASTERS.find(
    (master) =>
      master.telegramUsername?.toLowerCase() === username.toLowerCase()
  );
}

export function findMasterById(masterId: string) {
  return MOCK_MASTERS.find((master) => master.id === masterId);
}

/**
 * Знаходить майстра за Altegio staff_id
 */
export function findMasterByAltegioStaffId(staffId: number) {
  return MOCK_MASTERS.find((master) => master.altegioStaffId === staffId);
}

export function getMockAppointments(): AppointmentReminder[] {
  return MOCK_APPOINTMENTS;
}

export function findAppointmentById(id: string) {
  return MOCK_APPOINTMENTS.find((appointment) => appointment.id === id);
}

export function getUpcomingMockAppointmentsBuffer(minutesAhead = 15) {
  const now = Date.now();
  const ahead = now + minutesAhead * 60 * 1000;

  return MOCK_APPOINTMENTS.filter((appointment) => {
    const endAt = new Date(appointment.endAt).getTime();
    return endAt >= now && endAt <= ahead;
  });
}

/**
 * Конвертує Appointment з Altegio в AppointmentReminder для фото-звітів
 */
export function convertAltegioAppointmentToReminder(
  appointment: any, // Appointment з Altegio
  master: MasterProfile | undefined
): AppointmentReminder | null {
  if (!master) {
    return null;
  }

  // Отримуємо дати з appointment
  const startAt = appointment.start_datetime || appointment.datetime || appointment.date;
  const endAt = appointment.end_datetime || appointment.datetime || appointment.date;

  if (!startAt || !endAt) {
    console.warn(
      `[photo-reports] Appointment ${appointment.id} missing datetime fields`,
      appointment
    );
    return null;
  }

  // Отримуємо ім'я клієнта
  const clientName =
    appointment.client?.name ||
    appointment.client?.display_name ||
    appointment.client_name ||
    "Клієнт";

  // Отримуємо назву послуги
  const serviceName =
    appointment.service?.title ||
    appointment.service?.name ||
    appointment.service_name ||
    "Послуга";

  return {
    id: `altegio-${appointment.id}`,
    clientName,
    serviceName,
    masterId: master.id,
    masterName: master.name,
    startAt: new Date(startAt).toISOString(),
    endAt: new Date(endAt).toISOString(),
  };
}

