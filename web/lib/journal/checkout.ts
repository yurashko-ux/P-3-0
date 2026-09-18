// Каса MVP: закриття візиту (послуги + один рахунок оплати), dual-write з Altegio.

import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { fetchTimetableTransactionsForRecord } from "@/lib/altegio/record-payments";
import {
  closeVisitInAltegio,
  resolveAltegioVisitId,
} from "@/lib/altegio/visit-checkout-write";
import { resolveJournalCompanyId } from "./company-id";

function toMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function isDepositAccountTitle(title: string): boolean {
  const t = String(title || "").toLowerCase();
  return /депозит|deposit|рахунок клієнт|personal account|loyalty/.test(t);
}

export type CheckoutServiceLineInput = {
  lineId?: string;
  altegioServiceId: number;
  title?: string;
  amount?: number;
  cost: number;
};

export type CloseVisitInput = {
  appointmentId: string;
  services: CheckoutServiceLineInput[];
  accountId: number;
  accountTitle?: string;
  comment?: string;
};

export async function getCheckoutContext(appointmentId: string) {
  const appointment = await prisma.salonAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      lines: true,
      checkout: { include: { payments: true } },
      directClient: {
        select: { id: true, firstName: true, lastName: true, instagramUsername: true, phone: true },
      },
      master: { select: { id: true, name: true } },
    },
  });
  if (!appointment) throw new Error("Запис не знайдено");
  if (appointment.status === "deleted") throw new Error("Запис видалено");

  const accountsAll = await fetchAltegioAccounts();
  const accounts = accountsAll
    .filter((a) => !isDepositAccountTitle(a.title))
    .map((a) => ({
      id: Number(a.id),
      title: a.title,
      type: a.type,
    }))
    .filter((a) => a.id > 0);

  let altegioPaid = 0;
  let altegioPayments: Array<{ amount: number; date: string | null }> = [];
  if (appointment.altegioRecordId && appointment.altegioRecordId > 0) {
    const companyId = resolveJournalCompanyId();
    const txs = await fetchTimetableTransactionsForRecord(companyId, appointment.altegioRecordId);
    altegioPayments = txs
      .filter((t) => !t.deleted && t.amount > 0)
      .map((t) => ({ amount: t.amount, date: t.date }));
    altegioPaid = toMoney(altegioPayments.reduce((s, t) => s + t.amount, 0));
  }

  return {
    appointment,
    accounts,
    altegioPaid,
    altegioPayments,
    alreadyPaid:
      appointment.checkout?.status === "synced" ||
      (altegioPaid > 0 &&
        toMoney(appointment.lines.reduce((s, l) => s + (Number(l.cost) || 0), 0)) > 0 &&
        altegioPaid + 0.009 >= toMoney(appointment.lines.reduce((s, l) => s + (Number(l.cost) || 0), 0))),
  };
}

/** Підхопити оплату з Altegio без зворотного write. */
export async function upsertCheckoutFromAltegioPayments(params: {
  appointmentId: string;
  altegioRecordId: number;
  altegioVisitId?: number | null;
  kyivDay: string;
}) {
  const companyId = resolveJournalCompanyId();
  const txs = await fetchTimetableTransactionsForRecord(companyId, params.altegioRecordId);
  const live = txs.filter((t) => !t.deleted && t.amount > 0);
  if (live.length === 0) return null;

  const paidAmount = toMoney(live.reduce((s, t) => s + t.amount, 0));
  const appointment = await prisma.salonAppointment.findUnique({
    where: { id: params.appointmentId },
    include: { lines: true, checkout: { include: { payments: true } } },
  });
  if (!appointment) return null;

  const totalServices = toMoney(appointment.lines.reduce((s, l) => s + (Number(l.cost) || 0), 0));
  const existing = appointment.checkout;

  if (existing?.status === "synced" && existing.source === "kresco" && existing.paidAmount >= paidAmount - 0.01) {
    return existing;
  }

  const checkout = existing
    ? await prisma.salonCheckout.update({
        where: { id: existing.id },
        data: {
          altegioRecordId: params.altegioRecordId,
          altegioVisitId: params.altegioVisitId || existing.altegioVisitId,
          totalServices: totalServices || paidAmount,
          paidAmount,
          status: "synced",
          syncError: null,
          source: existing.source === "kresco" ? "kresco" : "altegio",
          kyivDay: params.kyivDay,
        },
      })
    : await prisma.salonCheckout.create({
        data: {
          appointmentId: params.appointmentId,
          altegioRecordId: params.altegioRecordId,
          altegioVisitId: params.altegioVisitId || null,
          totalServices: totalServices || paidAmount,
          paidAmount,
          status: "synced",
          source: "altegio",
          kyivDay: params.kyivDay,
        },
      });

  await prisma.salonCheckoutPayment.deleteMany({ where: { checkoutId: checkout.id } });
  for (const t of live) {
    await prisma.salonCheckoutPayment.create({
      data: {
        checkoutId: checkout.id,
        accountId: 0,
        accountTitle: "Altegio",
        amount: t.amount,
        altegioTransactionId: t.transactionId,
      },
    });
  }

  if (appointment.attendance !== 1) {
    await prisma.salonAppointment.update({
      where: { id: appointment.id },
      data: { attendance: 1 },
    });
  }

  console.log(
    `[journal/checkout] Upsert з Altegio appointment=${params.appointmentId} paid=${paidAmount} txs=${live.length}`,
  );
  return prisma.salonCheckout.findUnique({
    where: { id: checkout.id },
    include: { payments: true },
  });
}

export async function closeVisitFromKresco(input: CloseVisitInput) {
  const appointment = await prisma.salonAppointment.findUnique({
    where: { id: input.appointmentId },
    include: { lines: true, checkout: { include: { payments: true } } },
  });
  if (!appointment) throw new Error("Запис не знайдено");
  if (appointment.status === "deleted") throw new Error("Запис видалено");
  if (!(appointment.altegioRecordId && appointment.altegioRecordId > 0)) {
    throw new Error("Запис ще не має id Altegio — спочатку синхронізуйте журнал");
  }

  const services = (input.services || [])
    .map((s) => ({
      lineId: s.lineId,
      altegioServiceId: Number(s.altegioServiceId) || 0,
      title: s.title,
      amount: Number(s.amount) > 0 ? Number(s.amount) : 1,
      cost: toMoney(Number(s.cost) || 0),
    }))
    .filter((s) => s.altegioServiceId > 0 && s.cost >= 0);

  if (services.length === 0) throw new Error("Додайте хоча б одну послугу з сумою");

  const totalServices = toMoney(services.reduce((s, l) => s + l.cost, 0));
  if (!(totalServices > 0)) throw new Error("Сума послуг має бути більше 0");

  const accountId = Number(input.accountId) || 0;
  if (!(accountId > 0)) throw new Error("Оберіть рахунок оплати");

  const accounts = await fetchAltegioAccounts();
  const account = accounts.find((a) => Number(a.id) === accountId);
  if (!account) throw new Error("Рахунок Altegio не знайдено");
  if (isDepositAccountTitle(account.title)) {
    throw new Error("Оплата з депозиту клієнта — у наступному зрізі каси");
  }
  const accountTitle = input.accountTitle || account.title;

  // Ідемпотентність: уже оплачено на повну суму в Altegio або в Kresco.
  const companyId = resolveJournalCompanyId();
  const existingTxs = await fetchTimetableTransactionsForRecord(companyId, appointment.altegioRecordId);
  const altegioPaid = toMoney(
    existingTxs.filter((t) => !t.deleted && t.amount > 0).reduce((s, t) => s + t.amount, 0),
  );

  if (
    (appointment.checkout?.status === "synced" &&
      appointment.checkout.paidAmount + 0.009 >= totalServices) ||
    altegioPaid + 0.009 >= totalServices
  ) {
    const synced = await upsertCheckoutFromAltegioPayments({
      appointmentId: appointment.id,
      altegioRecordId: appointment.altegioRecordId,
      altegioVisitId: appointment.altegioVisitId,
      kyivDay: appointment.kyivDay,
    });
    console.log(`[journal/checkout] Ідемпотентний skip — уже оплачено ${altegioPaid || appointment.checkout?.paidAmount}`);
    return synced;
  }

  let visitId = Number(appointment.altegioVisitId) || 0;
  if (!(visitId > 0)) {
    visitId = (await resolveAltegioVisitId(appointment.altegioRecordId)) || 0;
    if (visitId > 0) {
      await prisma.salonAppointment.update({
        where: { id: appointment.id },
        data: { altegioVisitId: visitId },
      });
    }
  }
  if (!(visitId > 0)) {
    throw new Error("Немає visit_id Altegio — неможливо провести оплату через /visits");
  }

  // Оновлюємо суми послуг у Kresco до виклику Altegio.
  for (const s of services) {
    if (s.lineId) {
      await prisma.salonAppointmentLine.updateMany({
        where: { id: s.lineId, appointmentId: appointment.id },
        data: { cost: s.cost, amount: s.amount },
      });
    } else {
      await prisma.salonAppointmentLine.updateMany({
        where: { appointmentId: appointment.id, altegioServiceId: s.altegioServiceId },
        data: { cost: s.cost, amount: s.amount },
      });
    }
  }

  const pending =
    appointment.checkout ||
    (await prisma.salonCheckout.create({
      data: {
        appointmentId: appointment.id,
        altegioRecordId: appointment.altegioRecordId,
        altegioVisitId: visitId,
        totalServices,
        paidAmount: totalServices,
        status: "pending",
        source: "kresco",
        kyivDay: appointment.kyivDay,
        payments: {
          create: [{ accountId, accountTitle, amount: totalServices }],
        },
      },
      include: { payments: true },
    }));

  if (appointment.checkout) {
    await prisma.salonCheckout.update({
      where: { id: pending.id },
      data: {
        altegioRecordId: appointment.altegioRecordId,
        altegioVisitId: visitId,
        totalServices,
        paidAmount: totalServices,
        status: "pending",
        syncError: null,
        source: "kresco",
        kyivDay: appointment.kyivDay,
      },
    });
    await prisma.salonCheckoutPayment.deleteMany({ where: { checkoutId: pending.id } });
    await prisma.salonCheckoutPayment.create({
      data: { checkoutId: pending.id, accountId, accountTitle, amount: totalServices },
    });
  }

  try {
    const result = await closeVisitInAltegio({
      visitId,
      recordId: appointment.altegioRecordId,
      attendance: 1,
      comment: input.comment ?? appointment.comment ?? "",
      services: services.map((s) => ({
        id: s.altegioServiceId,
        amount: s.amount,
        firstCost: s.cost,
        cost: s.cost,
        discount: 0,
        title: s.title,
        recordId: appointment.altegioRecordId!,
      })),
      payments: [{ accountId, amount: totalServices }],
    });

    const txId = result.transactionIds[0] || null;
    await prisma.salonAppointment.update({
      where: { id: appointment.id },
      data: { attendance: 1, altegioVisitId: visitId },
    });
    const saved = await prisma.salonCheckout.update({
      where: { id: pending.id },
      data: {
        status: "synced",
        syncError: null,
        paidAmount: totalServices,
        totalServices,
        altegioVisitId: visitId,
      },
      include: { payments: true },
    });
    if (txId && saved.payments[0]) {
      await prisma.salonCheckoutPayment.update({
        where: { id: saved.payments[0].id },
        data: { altegioTransactionId: txId },
      });
    }
    console.log(
      `[journal/checkout] ✅ Закрито appointment=${appointment.id} → Altegio visit=${visitId} paid=${totalServices}`,
    );
    return prisma.salonCheckout.findUnique({
      where: { id: pending.id },
      include: { payments: true },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.salonCheckout.update({
      where: { id: pending.id },
      data: { status: "sync_error", syncError: message },
    });
    console.error(`[journal/checkout] Помилка закриття ${appointment.id}:`, message);
    throw new Error(message);
  }
}
