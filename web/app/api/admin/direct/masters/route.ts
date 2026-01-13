// web/app/api/admin/direct/masters/route.ts
// API endpoint для управління відповідальними (майстрами)

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectMasters, saveDirectMaster, deleteDirectMaster, getDirectMastersForSelection } from '@/lib/direct-masters/store';
import { randomUUID } from 'crypto';

function isAuthorized(req: NextRequest): boolean {
  // Проста перевірка авторизації (можна розширити)
  return true;
}

/**
 * GET - отримати список відповідальних
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = req.nextUrl;
    const forSelection = searchParams.get('forSelection') === 'true';

    if (forSelection) {
      try {
        const masters = await getDirectMastersForSelection();
        return NextResponse.json({ ok: true, masters });
      } catch (selectionErr) {
        console.error('[direct/masters] Error getting masters for selection:', selectionErr);
        // Повертаємо порожній масив замість помилки, щоб не ламати UI
        return NextResponse.json({ ok: true, masters: [] });
      }
    }

    const masters = await getAllDirectMasters();
    return NextResponse.json({ ok: true, masters });
  } catch (err) {
    console.error('[direct/masters] GET error:', err);
    // Повертаємо порожній масив замість помилки, щоб не ламати UI
    return NextResponse.json({ ok: true, masters: [] });
  }
}

/**
 * POST - створити нового відповідального
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, telegramUsername, telegramChatId, role = 'master', altegioStaffId, order = 0 } = body;

    if (!name) {
      return NextResponse.json(
        { ok: false, error: 'Name is required' },
        { status: 400 }
      );
    }

    // Конвертуємо telegramChatId в number або bigint (не використовуємо parseInt для великих чисел)
    let telegramChatIdValue: number | bigint | undefined = undefined;
    if (telegramChatId) {
      const chatIdStr = String(telegramChatId).trim();
      if (chatIdStr) {
        // Для великих чисел використовуємо BigInt, для малих - number
        const chatIdNum = Number(chatIdStr);
        if (!isNaN(chatIdNum) && isFinite(chatIdNum)) {
          // Якщо число більше за максимальне значення 32-бітного int, використовуємо BigInt
          if (chatIdNum > 2147483647 || chatIdNum < -2147483648) {
            telegramChatIdValue = BigInt(chatIdStr);
          } else {
            telegramChatIdValue = chatIdNum;
          }
        }
      }
    }

    const newMaster = {
      id: randomUUID(),
      name,
      telegramUsername: telegramUsername || undefined,
      telegramChatId: telegramChatIdValue,
      role: (role as 'master' | 'direct-manager' | 'admin') || 'master',
      altegioStaffId: altegioStaffId ? parseInt(String(altegioStaffId), 10) : undefined,
      isActive: true,
      order: order || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saved = await saveDirectMaster(newMaster);
    return NextResponse.json({ ok: true, master: saved });
  } catch (err) {
    console.error('[direct/masters] POST error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH - оновити відповідального
 */
export async function PATCH(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'ID is required' },
        { status: 400 }
      );
    }

    const existing = await getAllDirectMasters();
    const master = existing.find(m => m.id === id);

    if (!master) {
      return NextResponse.json(
        { ok: false, error: 'Master not found' },
        { status: 404 }
      );
    }

    const updated = {
      ...master,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const saved = await saveDirectMaster(updated);
    return NextResponse.json({ ok: true, master: saved });
  } catch (err) {
    console.error('[direct/masters] PATCH error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE - видалити відповідального
 */
export async function DELETE(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = req.nextUrl;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'ID is required' },
        { status: 400 }
      );
    }

    await deleteDirectMaster(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[direct/masters] DELETE error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
