// Поповнення завдатку з журналу: залишок веде реєстр Kresco, в Altegio — дубль, коли запис увімкнено.

import { prisma } from "@/lib/prisma";
import { listPaymentAccounts } from "@/lib/finance/own-accounts";
import { topUpClientDepositInAltegio } from "@/lib/altegio/deposit-topup-write";
import { appendDepositTopUp, listClientDepositOptions } from "@/lib/deposits/store";
import { isJournalAltegioWriteSkipped } from "@/lib/journal/altegio-write-gate";

function toMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function isDepositAccountTitle(title: string): boolean {
  const t = String(title || "").toLowerCase();
  return /депозит|deposit|рахунок клієнт|personal account|loyalty/.test(t);
}

export type DepositTopUpFromAppointmentInput = {
  appointmentId: string;
  depositId: number;
  amount: number;
  accountId: number;
  accountTitle?: string;
  comment?: string;
};

export async function topUpDepositFromAppointment(input: DepositTopUpFromAppointmentInput) {
  const appointment = await prisma.salonAppointment.findUnique({
    where: { id: input.appointmentId },
    include: {
      master: { select: { altegioStaffId: true } },
    },
  });
  if (!appointment) throw new Error("Запис не знайдено");
  if (appointment.status === "deleted") throw new Error("Запис видалено");

  const clientId = Number(appointment.altegioClientId) || 0;
  if (!(clientId > 0)) {
    throw new Error("Немає id клієнта Altegio — спочатку привʼяжіть клієнта до запису");
  }

  const depositId = Number(input.depositId) || 0;
  const amount = toMoney(Number(input.amount) || 0);
  const accountId = Number(input.accountId) || 0;
  if (!(depositId > 0)) throw new Error("Оберіть завдаток");
  if (!(amount > 0)) throw new Error("Сума поповнення має бути більше 0");
  if (!(accountId > 0)) throw new Error("Оберіть рахунок (Каса / ФОП), з якого поповнюєте");

  const accounts = await listPaymentAccounts();
  const account = accounts.find((a) => Number(a.id) === accountId);
  if (!account) throw new Error("Рахунок не знайдено");
  if (isDepositAccountTitle(account.title)) {
    throw new Error("Для поповнення оберіть касу/ФОП, а не особистий рахунок");
  }

  // Завдаток і його залишок — з реєстру Kresco.
  const options = await listClientDepositOptions({
    directClientId: appointment.directClientId,
    altegioClientId: clientId,
  });
  const deposit = options.find((d) => d.depositId === depositId);
  if (!deposit) throw new Error("Завдаток клієнта не знайдено в Kresco");
  if (deposit.blocked) throw new Error("Особистий рахунок заблоковано");

  const masterId =
    appointment.master?.altegioStaffId && appointment.master.altegioStaffId > 0
      ? appointment.master.altegioStaffId
      : appointment.altegioStaffId && appointment.altegioStaffId > 0
        ? appointment.altegioStaffId
        : null;

  const skipAltegio = isJournalAltegioWriteSkipped();
  const result = skipAltegio
    ? {
        documentId: null,
        depositTransactionId: null,
        paymentTransactionId: null,
        balanceAfter: null as number | null,
        raw: null,
      }
    : await topUpClientDepositInAltegio({
        clientId,
        depositId,
        amount,
        accountId,
        masterId,
        comment: input.comment || `Kresco каса ${appointment.kyivDay}`,
      });

  try {
    // Залишок після поповнення рахує реєстр Kresco, а не відповідь Altegio.
    const entry = await appendDepositTopUp({
      altegioClientId: clientId,
      altegioDepositId: depositId,
      amount,
      appointmentId: appointment.id,
      directClientId: appointment.directClientId,
      altegioDocumentId: result.documentId,
      altegioDepositTxId: result.depositTransactionId,
      altegioPaymentTxId: result.paymentTransactionId,
      kyivDay: appointment.kyivDay,
      comment: input.comment || `Поповнення з каси`,
      title: deposit.title,
    });
    result.balanceAfter = entry.balanceAfter;
  } catch (ledgerErr) {
    console.error(
      `[journal/deposit-topup] Ledger не записано${skipAltegio ? "" : " (Altegio уже поповнено)"}:`,
      ledgerErr instanceof Error ? ledgerErr.message : ledgerErr,
    );
    if (skipAltegio) throw ledgerErr;
  }

  // Оновлений список рахунків після поповнення — з реєстру.
  const clientDeposits = await listClientDepositOptions({
    directClientId: appointment.directClientId,
    altegioClientId: clientId,
  });

  console.log(
    `[journal/deposit-topup] appointment=${appointment.id} deposit=${depositId} +${amount} → balanceAfter=${result.balanceAfter ?? "—"}${skipAltegio ? " (лише Kresco)" : ""}`,
  );

  return {
    ...result,
    amount,
    accountId,
    accountTitle: input.accountTitle || account.title,
    depositTitle: deposit.title,
    clientDeposits,
  };
}
