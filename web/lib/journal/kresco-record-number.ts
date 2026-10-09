// Номер запису, народженого в Kresco. Імпорт з Altegio цей номер не отримує.

import { prisma } from "@/lib/prisma";

export function formatKrescoRecordNumber(n: number): string {
  return String(Math.trunc(n)).padStart(5, "0");
}

export async function nextKrescoRecordNumber(): Promise<number> {
  const max = await prisma.salonAppointment.aggregate({ _max: { krescoRecordNumber: true } });
  return (max._max.krescoRecordNumber ?? 0) + 1;
}

export function isKrescoRecordNumberConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: string }).code) : "";
  if (code !== "P2002") return false;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String).some((key) => key.includes("krescoRecordNumber"));
  if (typeof target === "string") return target.includes("krescoRecordNumber");
  return false;
}
