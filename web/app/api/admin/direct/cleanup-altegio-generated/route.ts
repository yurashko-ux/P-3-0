// web/app/api/admin/direct/cleanup-altegio-generated/route.ts
// Endpoint для видалення клієнтів з Altegio, які мають згенерований Instagram username

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, deleteDirectClient } from '@/lib/direct-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // Pro: 5 хв. Hobby: обмежено планом.

/**
 * POST - видалити всіх клієнтів з Altegio, які мають згенерований Instagram username
 */
export async function POST(req: NextRequest) {
  try {
    // Отримуємо всіх клієнтів
    const allClients = await getAllDirectClients();
    
    // Знаходимо клієнтів для видалення:
    // 1. Мають altegioClientId (інтегровані з Altegio)
    // 2. Instagram username починається з "altegio_" (згенерований)
    const clientsToDelete = allClients.filter(client => {
      const hasAltegioId = !!client.altegioClientId;
      const hasGeneratedInstagram = client.instagramUsername && client.instagramUsername.startsWith('altegio_');
      return hasAltegioId && hasGeneratedInstagram;
    });

    console.log(`[direct/cleanup-altegio-generated] Found ${clientsToDelete.length} clients to delete (out of ${allClients.length} total)`);

    const deleted: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    // Видаляємо клієнтів
    for (const client of clientsToDelete) {
      try {
        await deleteDirectClient(client.id);
        deleted.push(client.id);
        console.log(`[direct/cleanup-altegio-generated] ✅ Deleted client ${client.id} (@${client.instagramUsername}, Altegio ID: ${client.altegioClientId})`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push({ id: client.id, error: errorMsg });
        console.error(`[direct/cleanup-altegio-generated] ❌ Failed to delete client ${client.id}:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Видалено ${deleted.length} клієнтів з згенерованим Instagram username`,
      stats: {
        totalClients: allClients.length,
        foundToDelete: clientsToDelete.length,
        deleted: deleted.length,
        errors: errors.length,
      },
      deleted: deleted.slice(0, 20), // Перші 20 для перевірки
      errors: errors.slice(0, 10), // Перші 10 помилок
      deletedClients: clientsToDelete.map(c => ({
        id: c.id,
        instagramUsername: c.instagramUsername,
        altegioClientId: c.altegioClientId,
        name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || '-',
      })),
    });
  } catch (error) {
    console.error('[direct/cleanup-altegio-generated] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET - переглянути клієнтів, які будуть видалені (без видалення)
 */
export async function GET(req: NextRequest) {
  try {
    const allClients = await getAllDirectClients();
    
    const clientsToDelete = allClients.filter(client => {
      const hasAltegioId = !!client.altegioClientId;
      const hasGeneratedInstagram = client.instagramUsername && client.instagramUsername.startsWith('altegio_');
      return hasAltegioId && hasGeneratedInstagram;
    });

    return NextResponse.json({
      ok: true,
      message: `Знайдено ${clientsToDelete.length} клієнтів для видалення (з ${allClients.length} загалом)`,
      stats: {
        totalClients: allClients.length,
        toDelete: clientsToDelete.length,
      },
      clients: clientsToDelete.map(c => ({
        id: c.id,
        instagramUsername: c.instagramUsername,
        altegioClientId: c.altegioClientId,
        name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || '-',
        state: c.state,
        createdAt: c.createdAt,
      })),
      note: 'Використай POST для видалення цих клієнтів',
    });
  } catch (error) {
    console.error('[direct/cleanup-altegio-generated] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

