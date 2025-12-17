// web/app/api/admin/direct/sync-manychat/route.ts
// Синхронізація клієнтів з ManyChat webhook

import { NextRequest, NextResponse } from 'next/server';
import { getDirectClientByInstagram, saveDirectClient, getAllDirectStatuses } from '@/lib/direct-store';
import { readManychatMessage } from '@/lib/manychat-store';
import type { DirectClient } from '@/lib/direct-types';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/**
 * POST - синхронізувати клієнта з ManyChat
 * Викликається автоматично з webhook або вручну
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { messageId, instagramUsername, fullName, text, source } = body;

    // Якщо передано messageId, читаємо з ManyChat store
    let instagram: string | null = null;
    let firstName: string | undefined;
    let lastName: string | undefined;
    let messageText: string | undefined;

    if (messageId) {
      const message = await readManychatMessage();
      if (message) {
        instagram = message.handle || null;
        firstName = message.fullName?.split(' ')[0];
        lastName = message.fullName?.split(' ').slice(1).join(' ');
        messageText = message.text;
      }
    } else if (instagramUsername) {
      instagram = instagramUsername;
      if (fullName) {
        const parts = fullName.split(' ');
        firstName = parts[0];
        lastName = parts.slice(1).join(' ');
      }
      messageText = text;
    }

    if (!instagram) {
      return NextResponse.json(
        { ok: false, error: 'Instagram username is required' },
        { status: 400 }
      );
    }

    // Перевіряємо, чи існує клієнт
    let client = await getDirectClientByInstagram(instagram);

    const statuses = await getAllDirectStatuses();
    const defaultStatus = statuses.find((s) => s.isDefault) || statuses[0];

    if (!client) {
      // Створюємо нового клієнта
      const now = new Date().toISOString();
      client = {
        id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        instagramUsername: instagram,
        firstName,
        lastName,
        source: (source as 'instagram' | 'tiktok' | 'other') || 'instagram',
        firstContactDate: now,
        statusId: defaultStatus?.id || 'new',
        visitedSalon: false,
        signedUpForPaidService: false,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      };
    } else {
      // Оновлюємо існуючого клієнта
      client = {
        ...client,
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        lastMessageAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    await saveDirectClient(client);

    return NextResponse.json({ ok: true, client, created: !client.createdAt || client.createdAt === client.updatedAt });
  } catch (error) {
    console.error('[direct/sync-manychat] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
