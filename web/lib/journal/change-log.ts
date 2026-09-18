// Лог змін запису журналу.

import { prisma } from "@/lib/prisma";

export async function appendAppointmentChangeLog(params: {
  appointmentId: string;
  action: string;
  summary: string;
  actor?: string | null;
  before?: unknown;
  after?: unknown;
}) {
  try {
    await prisma.salonAppointmentChangeLog.create({
      data: {
        appointmentId: params.appointmentId,
        action: params.action,
        summary: params.summary.slice(0, 500),
        actor: params.actor || null,
        beforeJson: params.before != null ? JSON.stringify(params.before).slice(0, 4000) : null,
        afterJson: params.after != null ? JSON.stringify(params.after).slice(0, 4000) : null,
      },
    });
  } catch (err) {
    console.warn(
      `[journal/change-log] Не записали лог для ${params.appointmentId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function listAppointmentChangeLogs(appointmentId: string, take = 40) {
  return prisma.salonAppointmentChangeLog.findMany({
    where: { appointmentId },
    orderBy: { at: "desc" },
    take: Math.min(Math.max(take, 1), 100),
  });
}
