// Фінансова операція: один вхідний платіж і зріз ланцюжка на момент збереження.
// Картка клієнта далі може змінитись — цей рядок не перераховується.

import type { AuthContext } from "@/lib/auth-rbac";
import { parseStaffIdsJson } from "@/lib/journal/line-staff";
import { prisma } from "@/lib/prisma";

export const FINANCE_OPERATION_METHODS = ["cash", "card", "deposit"] as const;
export type FinanceOperationMethod = (typeof FINANCE_OPERATION_METHODS)[number];

export const FINANCE_OPERATION_METHOD_LABELS: Record<FinanceOperationMethod, string> = {
  cash: "Каса",
  card: "Картка",
  deposit: "Завдаток",
};

const AGENCY_LABELS: Record<string, string> = {
  agency_1: "Агенція 2 (зірочка)",
  agency_2: "Агенція 1 (серце)",
  organic: "Органіка",
};

export function leadAgencyLabel(value: string | null | undefined): string {
  if (!value) return "Без мітки";
  return AGENCY_LABELS[value] || value;
}

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isMethod(value: string): value is FinanceOperationMethod {
  return (FINANCE_OPERATION_METHODS as readonly string[]).includes(value);
}

function actorOf(auth: AuthContext): { userId: string | null; name: string } {
  if (auth.type === "user") {
    return { userId: auth.userId, name: String(auth.userName || auth.login || "Користувач").trim() };
  }
  return { userId: null, name: "Адміністратор" };
}

export type OperationLineSnapshot = {
  title: string;
  amount: number;
  staffName: string | null;
  altegioStaffId: number | null;
  sortOrder: number;
};

export type OperationPreview = {
  appointmentId: string;
  kyivDay: string;
  clientName: string;
  directClientId: string | null;
  suggestedAmount: number;
  leadAgency: string | null;
  leadAgencyLabel: string;
  consultationAt: string | null;
  consultationMasterId: string | null;
  consultationMasterName: string | null;
  lines: OperationLineSnapshot[];
};

function clientLabel(appointment: {
  clientName: string | null;
  directClient: {
    firstName: string | null;
    lastName: string | null;
    instagramUsername: string;
  } | null;
}): string {
  const fromCard = [appointment.directClient?.lastName, appointment.directClient?.firstName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return (
    appointment.clientName?.trim() ||
    fromCard ||
    appointment.directClient?.instagramUsername ||
    "Без імені"
  );
}

export async function previewFinanceOperation(appointmentId: string): Promise<OperationPreview> {
  const appointment = await prisma.salonAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      lines: { orderBy: { id: "asc" } },
      participants: { orderBy: { sortOrder: "asc" } },
      directClient: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          instagramUsername: true,
          leadAgency: true,
          consultationBookingDate: true,
          consultationMasterId: true,
          consultationMasterName: true,
        },
      },
    },
  });
  if (!appointment || appointment.status === "deleted") {
    throw new Error("Запис не знайдено");
  }

  const nameByStaff = new Map<number, string>();
  for (const participant of appointment.participants) {
    if (participant.altegioStaffId > 0 && participant.staffName) {
      nameByStaff.set(participant.altegioStaffId, participant.staffName);
    }
  }
  const participantIds = appointment.participants.map((p) => p.altegioStaffId).filter((id) => id > 0);

  const lines: OperationLineSnapshot[] = [];
  let sortOrder = 0;
  let suggested = 0;
  for (const line of appointment.lines) {
    const amount = money(line.cost);
    suggested = money(suggested + amount);
    const explicit = parseStaffIdsJson(line.staffIdsJson);
    const staffIds = explicit.length > 0 ? explicit : participantIds;
    const unique = [...new Set(staffIds.filter((id) => id > 0))];
    if (unique.length === 0) {
      lines.push({
        title: line.title || "Послуга",
        amount,
        staffName: appointment.staffName,
        altegioStaffId: appointment.altegioStaffId,
        sortOrder: sortOrder++,
      });
      continue;
    }
    for (const staffId of unique) {
      lines.push({
        title: line.title || "Послуга",
        amount,
        staffName: nameByStaff.get(staffId) || null,
        altegioStaffId: staffId,
        sortOrder: sortOrder++,
      });
    }
  }

  const client = appointment.directClient;
  const agency = client?.leadAgency?.trim() || null;
  return {
    appointmentId: appointment.id,
    kyivDay: appointment.kyivDay,
    clientName: clientLabel(appointment),
    directClientId: client?.id || appointment.directClientId,
    suggestedAmount: suggested,
    leadAgency: agency,
    leadAgencyLabel: leadAgencyLabel(agency),
    consultationAt: client?.consultationBookingDate ? client.consultationBookingDate.toISOString() : null,
    consultationMasterId: client?.consultationMasterId || null,
    consultationMasterName: client?.consultationMasterName || null,
    lines,
  };
}

export async function createFinanceOperation(
  auth: AuthContext,
  input: { appointmentId: string; amount: number; method: string; kyivDay: string },
) {
  const method = String(input.method || "").trim();
  if (!isMethod(method)) throw new Error("Спосіб: каса, картка або завдаток");
  const kyivDay = String(input.kyivDay || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(kyivDay)) throw new Error("День має бути YYYY-MM-DD");
  const amount = money(Number(input.amount));
  if (!(amount > 0)) throw new Error("Вкажіть суму платежу");

  const preview = await previewFinanceOperation(input.appointmentId);
  const actor = actorOf(auth);
  const created = await prisma.financeOperation.create({
    data: {
      kyivDay,
      amount,
      method,
      appointmentId: preview.appointmentId,
      directClientId: preview.directClientId,
      clientName: preview.clientName,
      leadAgency: preview.leadAgency,
      consultationAt: preview.consultationAt ? new Date(preview.consultationAt) : null,
      consultationMasterId: preview.consultationMasterId,
      consultationMasterName: preview.consultationMasterName,
      createdByUserId: actor.userId,
      createdByName: actor.name,
      lines: {
        create: preview.lines.map((line) => ({
          title: line.title,
          amount: line.amount,
          staffName: line.staffName,
          altegioStaffId: line.altegioStaffId,
          sortOrder: line.sortOrder,
        })),
      },
    },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  console.log(
    `[finance/operations] Платіж ${created.id} ${amount} ₴ ${method} запис=${preview.appointmentId} агенція=${preview.leadAgency || "—"} ким=${actor.name}`,
  );
  return created;
}

export async function listFinanceOperations(limit = 100) {
  const take = Math.min(Math.max(limit, 1), 200);
  return prisma.financeOperation.findMany({
    orderBy: [{ kyivDay: "desc" }, { createdAt: "desc" }],
    take,
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function searchAppointmentsForOperation(query: string) {
  const q = query.trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : null;
  const rows = await prisma.salonAppointment.findMany({
    where: {
      status: { not: "deleted" },
      ...(q
        ? {
            OR: [
              ...(day ? [{ kyivDay: day }] : []),
              { clientName: { contains: q, mode: "insensitive" } },
              { staffName: { contains: q, mode: "insensitive" } },
              {
                directClient: {
                  OR: [
                    { instagramUsername: { contains: q, mode: "insensitive" } },
                    { firstName: { contains: q, mode: "insensitive" } },
                    { lastName: { contains: q, mode: "insensitive" } },
                  ],
                },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ kyivDay: "desc" }, { datetime: "desc" }],
    take: 20,
    select: {
      id: true,
      kyivDay: true,
      clientName: true,
      staffName: true,
      directClient: { select: { firstName: true, lastName: true, instagramUsername: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    kyivDay: row.kyivDay,
    clientName: clientLabel(row),
    staffName: row.staffName,
  }));
}
