// API endpoint для скидання consultationAttended та paidServiceAttended до null
// для всіх клієнтів (оскільки в старій системі всі false були дефолтними значеннями)

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  try {
    // Оновлюємо всі записи, де consultationAttended = false, встановлюючи null
    const consultationResult = await prisma.directClient.updateMany({
      where: {
        consultationAttended: false,
      },
      data: {
        consultationAttended: null,
      },
    });

    // Оновлюємо всі записи, де paidServiceAttended = false, встановлюючи null
    const paidServiceResult = await prisma.directClient.updateMany({
      where: {
        paidServiceAttended: false,
      },
      data: {
        paidServiceAttended: null,
      },
    });

    return NextResponse.json({
      success: true,
      consultationAttendedReset: consultationResult.count,
      paidServiceAttendedReset: paidServiceResult.count,
      message: `Скинуто consultationAttended для ${consultationResult.count} записів, paidServiceAttended для ${paidServiceResult.count} записів`,
    });
  } catch (error: any) {
    console.error('[reset-attendance-fields] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Помилка при скиданні полів attendance',
      },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}
