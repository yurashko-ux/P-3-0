// Підготовка клієнта Direct для відображення в «Неактивній базі» (101+ днів з останнього візиту).

import { prisma } from '@/lib/prisma';
import { ACTIVE_BASE_MAX_DAYS } from '@/lib/inactive-base/days-since-last-visit';
import {
  computeDaysSinceLastVisit,
  getLastAttendedVisitDate,
} from '@/lib/inactive-base/days-since-last-visit';
import { isInactiveBaseByDaysSinceLastVisit } from '@/lib/inactive-base/is-inactive-client';

/** Днів «тому» для paidServiceDate — гарантовано > ACTIVE_BASE_MAX_DAYS. */
export const INACTIVE_BASE_ENSURE_DAYS_AGO = ACTIVE_BASE_MAX_DAYS + 10;

export async function findDirectClientsByNameParts(partA: string, partB: string) {
  const a = partA.trim();
  const b = partB.trim();
  if (!a && !b) return [];

  const clauses: Array<Record<string, unknown>> = [];
  if (a && b) {
    clauses.push({
      AND: [
        { firstName: { contains: a, mode: 'insensitive' as const } },
        { lastName: { contains: b, mode: 'insensitive' as const } },
      ],
    });
    clauses.push({
      AND: [
        { firstName: { contains: b, mode: 'insensitive' as const } },
        { lastName: { contains: a, mode: 'insensitive' as const } },
      ],
    });
  } else {
    const one = a || b;
    clauses.push({ firstName: { contains: one, mode: 'insensitive' as const } });
    clauses.push({ lastName: { contains: one, mode: 'insensitive' as const } });
    clauses.push({ instagramUsername: { contains: one, mode: 'insensitive' as const } });
  }

  return prisma.directClient.findMany({
    where: { OR: clauses },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      instagramUsername: true,
      phone: true,
      paidServiceAttended: true,
      paidServiceDate: true,
      paidServiceAttendanceValue: true,
      paidRecordsInHistoryCount: true,
      spent: true,
      lastVisitAt: true,
    },
    take: 15,
  });
}

export async function ensureDirectClientInInactiveBaseList(clientId: string): Promise<{
  clientId: string;
  firstName: string | null;
  lastName: string | null;
  daysSinceLastVisit: number | undefined;
  alreadyEligible: boolean;
  updated: boolean;
}> {
  const client = await prisma.directClient.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      paidServiceAttended: true,
      paidServiceDate: true,
      paidServiceAttendanceValue: true,
      paidRecordsInHistoryCount: true,
      spent: true,
      lastVisitAt: true,
      consultationAttended: true,
      consultationAttendanceValue: true,
      consultationDate: true,
      consultationBookingDate: true,
    },
  });

  if (!client) {
    throw new Error('Клієнта не знайдено');
  }

  const [withDays] = computeDaysSinceLastVisit([client]);
  const alreadyEligible = isInactiveBaseByDaysSinceLastVisit(
    withDays,
    withDays.daysSinceLastVisit
  );

  if (alreadyEligible) {
    return {
      clientId: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      daysSinceLastVisit: withDays.daysSinceLastVisit,
      alreadyEligible: true,
      updated: false,
    };
  }

  const paidServiceDate = new Date();
  paidServiceDate.setUTCDate(paidServiceDate.getUTCDate() - INACTIVE_BASE_ENSURE_DAYS_AGO);
  paidServiceDate.setUTCHours(12, 0, 0, 0);

  const data: {
    paidServiceAttended: boolean;
    paidServiceAttendanceValue: number;
    paidServiceDate: Date;
    spent?: number;
    lastVisitAt?: Date;
  } = {
    paidServiceAttended: true,
    paidServiceAttendanceValue: 1,
    paidServiceDate,
  };

  if (Number(client.spent ?? 0) <= 0) {
    data.spent = 1;
  }

  const lastIso = getLastAttendedVisitDate(client);
  if (!lastIso || new Date(lastIso) > paidServiceDate) {
    data.lastVisitAt = paidServiceDate;
  }

  await prisma.directClient.update({
    where: { id: clientId },
    data,
  });

  const [after] = computeDaysSinceLastVisit([
    {
      ...client,
      paidServiceAttended: true,
      paidServiceAttendanceValue: 1,
      paidServiceDate,
      spent: data.spent ?? client.spent,
      lastVisitAt: data.lastVisitAt ?? client.lastVisitAt,
    },
  ]);

  return {
    clientId: client.id,
    firstName: client.firstName,
    lastName: client.lastName,
    daysSinceLastVisit: after.daysSinceLastVisit,
    alreadyEligible: false,
    updated: true,
  };
}
