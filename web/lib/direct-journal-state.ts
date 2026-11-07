// Поля Direct, розраховані з журналу Kresco. У картки нічого не пише: поки лише для тіньової звірки.

import { determineStateFromServices, isHairExtensionServiceTitle } from "@/lib/direct-state-helper";
import { isConsultationServiceKind } from "@/lib/journal/altegio-write-gate";
import { prisma } from "@/lib/prisma";

export type JournalAppointment = {
  datetime: Date;
  attendance: number | null;
  staffName?: string | null;
  /** Товари чека: додаються лише після візиту, при створенні запису їх немає. */
  goodsTotal?: number;
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

/** Майстер, стан, сума й вогник поточного платного запису. Усі записи клієнта за день — один візит: майстри йдуть і паралельно, і поспіль. */
export function deriveDirectDetailsFromJournal(appointments: JournalAppointment[], now: Date = new Date()) {
  const paidRows = appointments.filter(isPaid);
  const current = currentAppointment(paidRows, now);
  if (!current) return null;
  const kyivDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const visit = paidRows.filter((a) => kyivDay(a.datetime) === kyivDay(current.datetime));
  const goods = Math.max(...visit.map((a) => a.goodsTotal ?? 0));
  const rowTotal = (a: JournalAppointment) => a.lines.reduce((sum, line) => sum + (Number(line.cost) || 0), 0);
  return {
    state: determineStateFromServices(current.lines),
    masters: [...new Set(visit.map((a) => a.staffName?.trim()).filter((name): name is string => !!name))],
    // Рядки дублюються в записах кількох майстрів, тому допускаємо суму одного запису і всього візиту.
    totals: [rowTotal(current), visit.reduce((sum, a) => sum + rowTotal(a), 0)].flatMap((total) => [total, total + goods]),
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

/** Картка тримає салонний час із позначкою UTC. */
function toCardDate(date: Date): string {
  return `${date.toLocaleString("sv-SE", { timeZone: "Europe/Kyiv" }).replace(" ", "T")}.000Z`;
}

function sameKyivDay(a: Date, b: Date): boolean {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return day(a) === day(new Date(toCardDate(b)));
}

type CardChange = { field: string; from: unknown; to: unknown };

/** Що записав би крок 4. Той самий день не чіпаємо: це перенесення в межах дня або два записи одного візиту. */
function planCardChanges(
  card: {
    consultationBookingDate: Date | null;
    consultationAttended: boolean | null;
    paidServiceDate: Date | null;
    paidServiceAttended: boolean | null;
    consultationCancelled: boolean;
    paidServiceCancelled: boolean;
    paidServiceTotalCost: number | null;
    serviceMasterName: string | null;
  },
  journal: JournalDirectFields,
  detail: ReturnType<typeof deriveDirectDetailsFromJournal>,
): CardChange[] {
  const changes: CardChange[] = [];
  const date = (
    field: string,
    current: Date | null,
    next: Date | null,
    attendedField: string,
    attended: boolean | null,
    nextAttended: boolean | null,
  ) => {
    if (!next) return;
    if (current && sameMinute(current, next)) {
      if (attended !== true && nextAttended !== null && attended !== nextAttended) {
        changes.push({ field: attendedField, from: attended, to: nextAttended });
      }
      return;
    }
    if (current && sameKyivDay(current, next)) return;
    // Минулу дату назад не рухаємо: картка могла бачити запис, який журнал рахує інакше.
    if (current && next < current && next < new Date()) return;
    changes.push({ field, from: current, to: toCardDate(next) });
    // Новий запис — нова відмітка: «прийшов» минулого запису до нього не стосується.
    if (attended !== nextAttended) changes.push({ field: attendedField, from: attended, to: nextAttended });
  };
  date("consultationBookingDate", card.consultationBookingDate, journal.consultationBookingDate, "consultationAttended", card.consultationCancelled ? false : card.consultationAttended, journal.consultationAttended);
  date("paidServiceDate", card.paidServiceDate, journal.paidServiceDate, "paidServiceAttended", card.paidServiceCancelled ? false : card.paidServiceAttended, journal.paidServiceAttended);
  if (detail) {
    const total = Math.round(detail.totals[3]);
    if (total > 0 && total !== card.paidServiceTotalCost) {
      changes.push({ field: "paidServiceTotalCost", from: card.paidServiceTotalCost, to: total });
    }
    const master = card.serviceMasterName ?? "";
    if (detail.masters.length > 0 && !detail.masters.some((name) => master.includes(name))) {
      changes.push({ field: "serviceMasterName", from: card.serviceMasterName, to: detail.masters.join(", ") });
    }
  }
  return changes;
}

/**
 * Оновлює картку одного клієнта після зміни запису в Kresco. Три запити до БД, четвертий — лише якщо є зміни.
 * Правила ті самі, що в №107. Помилка не має ламати збереження запису — її ловить той, хто викликає.
 */
export async function syncDirectCardFromJournal(appointmentId: string) {
  const appointment = await prisma.salonAppointment.findUnique({
    where: { id: appointmentId },
    select: { directClientId: true },
  });
  const directClientId = appointment?.directClientId;
  if (!directClientId) return { changes: [] as CardChange[] };
  const [rows, client] = await Promise.all([
    prisma.salonAppointment.findMany({
      where: {
        directClientId,
        datetime: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
        status: { not: "deleted" },
      },
      select: {
        datetime: true,
        attendance: true,
        staffName: true,
        checkout: { select: { totalGoods: true, status: true } },
        lines: { select: { title: true, cost: true, service: { select: { kind: true } } } },
      },
    }),
    prisma.directClient.findUnique({
      where: { id: directClientId },
      select: {
        consultationBookingDate: true,
        consultationAttended: true,
        paidServiceDate: true,
        paidServiceAttended: true,
        consultationCancelled: true,
        paidServiceCancelled: true,
        paidServiceTotalCost: true,
        serviceMasterName: true,
        updatedAt: true,
      },
    }),
  ]);
  if (!client) return { changes: [] as CardChange[] };
  const journalRows: JournalAppointment[] = rows.map((a) => ({
    datetime: a.datetime,
    attendance: a.attendance,
    staffName: a.staffName,
    goodsTotal: a.checkout && a.checkout.status !== "void" ? Number(a.checkout.totalGoods) || 0 : 0,
    lines: a.lines.map((l) => ({ title: l.title, cost: l.cost, kind: l.service?.kind })),
  }));
  const changes = planCardChanges(
    client,
    deriveDirectFieldsFromJournal(journalRows),
    deriveDirectDetailsFromJournal(journalRows),
  );
  if (changes.length === 0) return { changes };
  const data: Record<string, unknown> = { updatedAt: client.updatedAt };
  for (const change of changes) data[change.field] = change.to;
  console.log("[direct-journal-state] Автооновлення картки з журналу", directClientId, JSON.stringify(changes));
  await prisma.directClient.update({ where: { id: directClientId }, data });
  return { changes };
}

/** Для маршрутів журналу: запис уже збережено, тому збій картки лише логуємо. */
export async function refreshDirectCardAfterJournalChange(appointmentId: string) {
  try {
    await syncDirectCardFromJournal(appointmentId);
  } catch (err) {
    console.error("[direct-journal-state] Не вдалось оновити картку після зміни запису", appointmentId, err);
  }
}

/** Два запити до БД на весь запуск. Лише читання. */
export async function compareDirectWithJournal(days: number, sampleLimit = 40, options?: { apply?: boolean }) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const appointments = await prisma.salonAppointment.findMany({
    where: { datetime: { gte: since }, status: { not: "deleted" }, directClientId: { not: null } },
    select: {
      directClientId: true,
      datetime: true,
      attendance: true,
      staffName: true,
      checkout: { select: { totalGoods: true, status: true } },
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
      goodsTotal: a.checkout && a.checkout.status !== "void" ? Number(a.checkout.totalGoods) || 0 : 0,
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
      updatedAt: true,
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
  const plan = { clients: 0, byField: {} as Record<string, number>, rows: [] as Array<Record<string, unknown>> };
  const toApply: Array<{ id: string; updatedAt: Date; changes: CardChange[] }> = [];
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
    const changes = planCardChanges(client, journal, detail);
    if (changes.length > 0) {
      plan.clients += 1;
      toApply.push({ id: client.id, updatedAt: client.updatedAt, changes });
      for (const change of changes) plan.byField[change.field] = (plan.byField[change.field] || 0) + 1;
      if (plan.rows.length < 200) {
        plan.rows.push({
          client: [client.lastName, client.firstName].filter(Boolean).join(" ") || client.instagramUsername,
          changes,
        });
      }
    }
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
  let applied = 0;
  if (options?.apply) {
    for (const item of toApply) {
      const data: Record<string, unknown> = { updatedAt: item.updatedAt };
      for (const change of item.changes) data[change.field] = change.to;
      // Попередні значення в логах: за ними зміну можна відкотити.
      console.log("[direct-journal-state] Оновлення картки з журналу", item.id, JSON.stringify(item.changes));
      await prisma.directClient.update({ where: { id: item.id }, data });
      applied += 1;
    }
  }
  return { applied, days, compared: clients.length, matched, counts, samples, details, detailSamples, plan };
}
