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

