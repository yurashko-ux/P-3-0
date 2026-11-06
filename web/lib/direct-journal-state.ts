// Поля Direct, розраховані з журналу Kresco. У картки нічого не пише: поки лише для тіньової звірки.

import { determineStateFromServices } from "@/lib/direct-state-helper";
import { isConsultationServiceKind } from "@/lib/journal/altegio-write-gate";
import { prisma } from "@/lib/prisma";

export type JournalAppointment = {
  datetime: Date;
  attendance: number | null;
  lines: Array<{ title: string; cost: number; kind?: string | null }>;
};

export type JournalDirectFields = {
  consultationBookingDate: Date | null;
  consultationAttended: boolean | null;
  paidServiceDate: Date | null;
  paidServiceAttended: boolean | null;
};

function isConsultation(appointment: JournalAppointment): boolean {
  return appointment.lines.some(
    (line) => isConsultationServiceKind(line.kind) || /консультаці/i.test(line.title),
  );
}

/** Платний запис: нарощування має пріоритет навіть поруч із консультацією. */
function isPaid(appointment: JournalAppointment): boolean {
  const state = determineStateFromServices(appointment.lines);
  return state === "hair-extension" || state === "other-services";
}

function latest(appointments: JournalAppointment[]): JournalAppointment | null {
  return appointments.reduce<JournalAppointment | null>(
    (best, a) => (!best || a.datetime > best.datetime ? a : best),
    null,
  );
}

/** 1 або 2 = прийшов, -1 = не з'явився. На консультації 2 до дати візиту означає лише підтвердження. */
function attendedFromMark(attendance: number | null, confirmedCounts: boolean): boolean | null {
  if (attendance === 1 || (attendance === 2 && confirmedCounts)) return true;
  if (attendance === -1) return false;
  return null;
}

export function deriveDirectFieldsFromJournal(
  appointments: JournalAppointment[],
  now: Date = new Date(),
): JournalDirectFields {
  const paid = latest(appointments.filter(isPaid));
  const consultation = latest(appointments.filter((a) => isConsultation(a) && !isPaid(a)));
  return {
    consultationBookingDate: consultation?.datetime ?? null,
    consultationAttended: consultation
      ? attendedFromMark(consultation.attendance, consultation.datetime <= now)
      : null,
    paidServiceDate: paid?.datetime ?? null,
    paidServiceAttended: paid ? attendedFromMark(paid.attendance, true) : null,
  };
}

type FieldDiff = "journalNewer" | "cardNewer" | "attendance";

function sameMinute(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) < 60_000;
}

function compareBlock(
  card: { date: Date | null; attended: boolean | null },
  journal: { date: Date | null; attended: boolean | null },
): FieldDiff | null {
  if (!journal.date) return null;
  if (!card.date || journal.date > card.date) {
    return card.date && sameMinute(card.date, journal.date) ? null : "journalNewer";
  }
  if (!sameMinute(card.date, journal.date)) return "cardNewer";
  return (card.attended ?? null) === journal.attended ? null : "attendance";
}

/** Два запити до БД на весь запуск. Лише читання. */
export async function compareDirectWithJournal(days: number, sampleLimit = 40) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const appointments = await prisma.salonAppointment.findMany({
    where: { datetime: { gte: since }, status: { not: "deleted" }, directClientId: { not: null } },
    select: {
      directClientId: true,
      datetime: true,
      attendance: true,
      lines: { select: { title: true, cost: true, service: { select: { kind: true } } } },
    },
  });
  const byClient = new Map<string, JournalAppointment[]>();
  for (const a of appointments) {
    const list = byClient.get(a.directClientId!) ?? [];
    list.push({
      datetime: a.datetime,
      attendance: a.attendance,
      lines: a.lines.map((l) => ({ title: l.title, cost: l.cost, kind: l.service?.kind })),
    });
    byClient.set(a.directClientId!, list);
  }
  const clients = await prisma.directClient.findMany({
    where: { id: { in: [...byClient.keys()] } },
    select: {
      id: true,
      instagramUsername: true,
      firstName: true,
      lastName: true,
      consultationBookingDate: true,
      consultationAttended: true,
      paidServiceDate: true,
      paidServiceAttended: true,
    },
  });

  const counts = {
    consultation: { journalNewer: 0, cardNewer: 0, attendance: 0 },
    paid: { journalNewer: 0, cardNewer: 0, attendance: 0 },
  };
  const samples: Array<Record<string, unknown>> = [];
  let matched = 0;
  for (const client of clients) {
    const journal = deriveDirectFieldsFromJournal(byClient.get(client.id) ?? []);
    const consultation = compareBlock(
      { date: client.consultationBookingDate, attended: client.consultationAttended },
      { date: journal.consultationBookingDate, attended: journal.consultationAttended },
    );
    const paid = compareBlock(
      { date: client.paidServiceDate, attended: client.paidServiceAttended },
      { date: journal.paidServiceDate, attended: journal.paidServiceAttended },
    );
    if (consultation) counts.consultation[consultation] += 1;
    if (paid) counts.paid[paid] += 1;
    if (!consultation && !paid) {
      matched += 1;
      continue;
    }
    if (samples.length < sampleLimit) {
      samples.push({
        client: [client.lastName, client.firstName].filter(Boolean).join(" ") || client.instagramUsername,
        consultation,
        paid,
        card: {
          consultationBookingDate: client.consultationBookingDate,
          consultationAttended: client.consultationAttended,
          paidServiceDate: client.paidServiceDate,
          paidServiceAttended: client.paidServiceAttended,
        },
        journal,
      });
    }
  }
  return { days, compared: clients.length, matched, counts, samples };
}
