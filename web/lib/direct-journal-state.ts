// Поля Direct, розраховані з журналу Kresco. У картки нічого не пише: поки лише для тіньової звірки.

import { determineStateFromServices, isHairExtensionServiceTitle } from "@/lib/direct-state-helper";
import { isConsultationServiceKind } from "@/lib/journal/altegio-write-gate";
import { prisma } from "@/lib/prisma";

export type JournalAppointment = {
  datetime: Date;
  attendance: number | null;
  staffName?: string | null;
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

/** Платний запис — будь-яка послуга, крім консультації. Ціни майбутніх записів у журналі часто ще 0, тому суму не перевіряємо. */
function isPaid(appointment: JournalAppointment): boolean {
  return appointment.lines.some((line) => {
    if (!line.title.trim() || isConsultationServiceKind(line.kind)) return false;
    return isHairExtensionServiceTitle(line.title) || !/консультаці/i.test(line.title);
  });
}

/** Найближчий майбутній запис, а якщо його немає — останній минулий. */
function currentAppointment(appointments: JournalAppointment[], now: Date): JournalAppointment | null {
  const byDate = [...appointments].sort((a, b) => a.datetime.getTime() - b.datetime.getTime());
  return byDate.find((a) => a.datetime >= now) ?? byDate[byDate.length - 1] ?? null;
}

/** 1 або 2 = прийшов, -1 = не з'явився. На консультації 2 до дати візиту означає лише підтвердження. */
function attendedFromMark(attendance: number | null, confirmedCounts: boolean): boolean | null {
  if (attendance === 1 || (attendance === 2 && confirmedCounts)) return true;
  if (attendance === -1) return false;
  return null;
}

/** Майстер, стан, сума й вогник поточного платного запису. Записи одного часу — це один візит кількох майстрів. */
export function deriveDirectDetailsFromJournal(appointments: JournalAppointment[], now: Date = new Date()) {
  const paidRows = appointments.filter(isPaid);
  const current = currentAppointment(paidRows, now);
  if (!current) return null;
  const visit = paidRows.filter((a) => a.datetime.getTime() === current.datetime.getTime());
  const rowTotal = (a: JournalAppointment) => a.lines.reduce((sum, line) => sum + (Number(line.cost) || 0), 0);
  return {
    state: determineStateFromServices(current.lines),
    masters: [...new Set(visit.map((a) => a.staffName?.trim()).filter((name): name is string => !!name))],
    // Рядки дублюються в записах кількох майстрів, тому допускаємо суму одного запису і всього візиту.
    totals: [rowTotal(current), visit.reduce((sum, a) => sum + rowTotal(a), 0)],
    hadPaidBefore: paidRows.some((a) => a.datetime < current.datetime && a.attendance === 1),
  };
}

export function deriveDirectFieldsFromJournal(
  appointments: JournalAppointment[],
  now: Date = new Date(),
): JournalDirectFields {
  const paid = currentAppointment(appointments.filter(isPaid), now);
  const consultation = currentAppointment(appointments.filter((a) => isConsultation(a) && !isPaid(a)), now);
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

/** Вебхук зберігає салонний час із позначкою UTC, журнал — справжній UTC: різниця 2 або 3 години не є розбіжністю. */
function sameMinute(card: Date, journal: Date): boolean {
  const diff = card.getTime() - journal.getTime();
  return [0, 2, 3].some((hours) => Math.abs(diff - hours * 3_600_000) < 60_000);
}

function compareBlock(
  card: { date: Date | null; attended: boolean | null },
  journal: { date: Date | null; attended: boolean | null },
): FieldDiff | null {
  if (!journal.date) return null;
  if (!card.date) return "journalNewer";
  if (!sameMinute(card.date, journal.date)) {
    return journal.date > card.date ? "journalNewer" : "cardNewer";
  }
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
      staffName: true,
      lines: { select: { title: true, cost: true, service: { select: { kind: true } } } },
    },
  });
  const byClient = new Map<string, JournalAppointment[]>();
  for (const a of appointments) {
    const list = byClient.get(a.directClientId!) ?? [];
    list.push({
      datetime: a.datetime,
      attendance: a.attendance,
      staffName: a.staffName,
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
      consultationCancelled: true,
      paidServiceCancelled: true,
      state: true,
      serviceMasterName: true,
      paidServiceTotalCost: true,
      paidRecordsInHistoryCount: true,
    },
  });

  const counts = {
    consultation: { journalNewer: 0, cardNewer: 0, attendance: 0 },
    paid: { journalNewer: 0, cardNewer: 0, attendance: 0 },
  };
  const samples: Array<Record<string, unknown>> = [];
  const details = {
    compared: 0,
    masterDiff: 0,
    totalDiff: 0,
    totalJournalZero: 0,
    /** Картка каже «перший платний» (вогник), а в журналі вже був відвіданий платний запис. */
    fireDiff: 0,
    /** Пари «стан картки → стан із журналу»: стан картки має проміжні значення, тому без оцінки. */
    statePairs: {} as Record<string, number>,
  };
  const detailSamples: Array<Record<string, unknown>> = [];
  let matched = 0;
  for (const client of clients) {
    const journal = deriveDirectFieldsFromJournal(byClient.get(client.id) ?? []);
    const consultation = compareBlock(
      { date: client.consultationBookingDate, attended: client.consultationCancelled ? false : client.consultationAttended },
      { date: journal.consultationBookingDate, attended: journal.consultationAttended },
    );
    const paid = compareBlock(
      { date: client.paidServiceDate, attended: client.paidServiceCancelled ? false : client.paidServiceAttended },
      { date: journal.paidServiceDate, attended: journal.paidServiceAttended },
    );
    // -1 до дати візиту картка тримає як «скасовано», а не «не з'явився».
    const detail = deriveDirectDetailsFromJournal(byClient.get(client.id) ?? []);
    if (detail && !paid) {
      details.compared += 1;
      const stateKey = `${client.state ?? "—"} → ${detail.state ?? "—"}`;
      details.statePairs[stateKey] = (details.statePairs[stateKey] || 0) + 1;
      const cardMaster = client.serviceMasterName ?? "";
      const masterDiff = detail.masters.length > 0 && !detail.masters.some((name) => cardMaster.includes(name));
      const hasJournalTotal = detail.totals[0] > 0;
      const totalDiff =
        hasJournalTotal && client.paidServiceTotalCost != null && !detail.totals.includes(client.paidServiceTotalCost);
      const fireDiff = client.paidRecordsInHistoryCount === 0 && detail.hadPaidBefore;
      if (masterDiff) details.masterDiff += 1;
      if (totalDiff) details.totalDiff += 1;
      if (!hasJournalTotal) details.totalJournalZero += 1;
      if (fireDiff) details.fireDiff += 1;
      if ((masterDiff || totalDiff || fireDiff) && detailSamples.length < sampleLimit) {
        detailSamples.push({
          client: [client.lastName, client.firstName].filter(Boolean).join(" ") || client.instagramUsername,
          masterDiff,
          totalDiff,
          fireDiff,
          card: {
            master: client.serviceMasterName,
            total: client.paidServiceTotalCost,
            paidBefore: client.paidRecordsInHistoryCount,
          },
          journal: detail,
        });
      }
    }
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
        journalRows: (byClient.get(client.id) ?? []).map((a) => ({
          datetime: a.datetime,
          state: determineStateFromServices(a.lines),
          lines: a.lines.map((l) => `${l.title}: ${l.cost}`),
        })),
      });
    }
  }
  return { days, compared: clients.length, matched, counts, samples, details, detailSamples };
}
