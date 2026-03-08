// web/app/api/admin/direct/add-client/route.ts
// Endpoint для ручного додавання клієнта

import { NextRequest, NextResponse } from 'next/server';
import { getDirectClientByInstagram, saveDirectClient } from '@/lib/direct-store';
import { normalizeInstagram } from '@/lib/normalize';
import type { DirectClient } from '@/lib/direct-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST - додати клієнта вручну
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { instagramUsername, firstName, lastName, source } = body;

    if (!instagramUsername) {
      return NextResponse.json(
        { ok: false, error: 'Instagram username is required' },
        { status: 400 }
      );
    }

    // Нормалізуємо Instagram username
    const normalized = normalizeInstagram(instagramUsername);
    if (!normalized) {
      return NextResponse.json(
        { ok: false, error: 'Invalid Instagram username format' },
        { status: 400 }
      );
    }

    // Перевіряємо, чи існує клієнт
    let client = await getDirectClientByInstagram(normalized);

    if (!client) {
      // Створюємо нового клієнта (ручне додавання — завжди лід, без Altegio)
      const now = new Date().toISOString();
      client = {
        id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        instagramUsername: normalized,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        source: (source as 'instagram' | 'tiktok' | 'other') || 'instagram',
        state: 'message' as const,
        firstContactDate: now,
        statusId: 'lead',
        visitedSalon: false,
        signedUpForPaidService: false,
        createdAt: now,
        updatedAt: now,
      };
      await saveDirectClient(client, 'add-client', { source: 'admin' }, { touchUpdatedAt: false });
      
      return NextResponse.json({
        ok: true,
        message: 'Клієнт створено',
        client,
        created: true,
      });
    } else {
      // Оновлюємо існуючого клієнта
      const updated = {
        ...client,
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
      };
      await saveDirectClient(updated, 'add-client', { source: 'admin' }, { touchUpdatedAt: false });
      
      return NextResponse.json({
        ok: true,
        message: 'Клієнт оновлено',
        client: updated,
        created: false,
      });
    }
  } catch (err) {
    console.error('[add-client] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

