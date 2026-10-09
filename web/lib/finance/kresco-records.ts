// Список записів, створених у Kresco. Імпорт Altegio сюди не входить.

import { prisma } from "@/lib/prisma";
import { formatKrescoRecordNumber } from "@/lib/journal/kresco-record-number";

export type KrescoRecordRow = {
  id: string;
  number: string;
  kyivDay: string;
  time: string;
  client: string;
  phone: string | null;
  master: string;
  status: string;
  serviceTitle: string;
};

function kyivTime(datetime: Date): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(datetime);
}

export async function listKrescoRecords(limit = 200): Promise<KrescoRecordRow[]> {
  const take = Math.min(Math.max(limit, 1), 500);
  const rows = await prisma.salonAppointment.findMany({
    // Видалений у журналі запис (status deleted) у цьому списку не показуємо.
    where: { krescoRecordNumber: { not: null }, status: { not: "deleted" } },
    orderBy: { krescoRecordNumber: "desc" },
    take,
    select: {
      id: true,
      krescoRecordNumber: true,
      kyivDay: true,
      datetime: true,
      clientName: true,
      clientPhone: true,
      staffName: true,
      status: true,
      directClient: { select: { firstName: true, lastName: true, phone: true, instagramUsername: true } },
      master: { select: { name: true } },
      lines: { select: { title: true }, orderBy: { title: "asc" } },
    },
  });

  return rows.map((row) => {
    const client =
      row.clientName ||
      [row.directClient?.lastName, row.directClient?.firstName].filter(Boolean).join(" ") ||
      row.directClient?.instagramUsername ||
      "—";
    return {
      id: row.id,
      number: formatKrescoRecordNumber(row.krescoRecordNumber || 0),
      kyivDay: row.kyivDay,
      time: kyivTime(row.datetime),
      client,
      phone: row.clientPhone || row.directClient?.phone || null,
      master: row.staffName || row.master?.name || "—",
      status: row.status,
      serviceTitle: row.lines.map((line) => line.title).filter(Boolean).join(", "),
    };
  });
}
