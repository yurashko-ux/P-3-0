// Поповнення завдатку з журналу / каси (dual-write в Altegio).

import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { fetchDepositsForClientIds } from "@/lib/altegio/client-deposits";
import { topUpClientDepositInAltegio } from "@/lib/altegio/deposit-topup-write";

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

  const accounts = await fetchAltegioAccounts();
  const account = accounts.find((a) => Number(a.id) === accountId);
  if (!account) throw new Error("Рахунок Altegio не знайдено");
  if (isDepositAccountTitle(account.title)) {
    throw new Error("Для поповнення оберіть касу/ФОП, а не особистий рахунок");
  }

  const dep = await fetchDepositsForClientIds({ clientIds: [clientId] });
  const deposit = (dep.deposits || []).find((d) => d.depositId === depositId);
  if (!deposit) throw new Error("Завдаток клієнта не знайдено в Altegio");
  if (deposit.blocked) throw new Error("Особистий рахунок заблоковано");

  const masterId =
    appointment.master?.altegioStaffId && appointment.master.altegioStaffId > 0
      ? appointment.master.altegioStaffId
      : appointment.altegioStaffId && appointment.altegioStaffId > 0
        ? appointment.altegioStaffId
        : null;

  const result = await topUpClientDepositInAltegio({
    clientId,
    depositId,
    amount,
    accountId,
    masterId,
    comment: input.comment || `Kresco каса ${appointment.kyivDay}`,
  });

  // Оновлений список рахунків після поповнення
  const refreshed = await fetchDepositsForClientIds({ clientIds: [clientId] });
  const clientDeposits = (refreshed.deposits || [])
    .filter((d) => d.depositId > 0)
    .map((d) => ({
      depositId: d.depositId,
      balance: toMoney(d.balance),
      title: d.depositTypeTitle || "Особистий рахунок",
      blocked: Boolean(d.blocked),
    }))
    .sort((a, b) => b.balance - a.balance);

  console.log(
    `[journal/deposit-topup] ✅ appointment=${appointment.id} deposit=${depositId} +${amount} → balanceAfter=${result.balanceAfter ?? "—"}`,
  );

  return {
    ...result,
    amount,
    accountId,
    accountTitle: input.accountTitle || account.title,
    depositTitle: deposit.depositTypeTitle || "Особистий рахунок",
    clientDeposits,
  };
}
