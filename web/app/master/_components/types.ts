export type MasterAppointment = {
  id: string;
  datetime: string;
  seanceLength: number;
  attendance: number;
  clientName: string | null;
  clientPhone: string | null;
  lines: Array<{ title: string }>;
  directClient: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    visits: number | null;
    lastVisitAt: string | null;
  } | null;
};
