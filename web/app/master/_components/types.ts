export type MasterAppointment = {
  id: string;
  datetime: string;
  seanceLength: number;
  attendance: number;
  clientName: string | null;
  clientPhone: string | null;
  /** Ім'я майстра — заповнене лише в адмін-режимі (бачить усіх). */
  staffName: string | null;
  lines: Array<{ title: string }>;
  directClient: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    visits: number | null;
    lastVisitAt: string | null;
  } | null;
};
