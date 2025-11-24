// web/app/api/altegio/webhook/route.ts
// Webhook endpoint для отримання сповіщень від Altegio API

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Webhook endpoint для Altegio
 * Отримує сповіщення про події в Altegio (appointments, clients, etc.)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    
    console.log('[altegio/webhook] Received webhook:', {
      timestamp: new Date().toISOString(),
      bodyKeys: Object.keys(body),
      eventType: body.event || body.type || 'unknown',
    });
    
    // Тут можна додати обробку різних типів подій від Altegio
    // Наприклад: appointment.created, appointment.updated, client.created, etc.
    
    // Поки що просто логуємо отримані дані
    if (body.event) {
      console.log('[altegio/webhook] Event:', body.event, body);
    }
    
    // Повертаємо успішну відповідь
    return NextResponse.json({ 
      ok: true, 
      received: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[altegio/webhook] Error processing webhook:', error);
    
    // Важливо: повертаємо 200 OK навіть при помилці,
    // щоб Altegio не намагався повторно надсилати webhook
    return NextResponse.json({ 
      ok: false, 
      error: error instanceof Error ? error.message : String(error),
    }, { status: 200 });
  }
}

// GET для перевірки, що endpoint працює
export async function GET(req: NextRequest) {
  return NextResponse.json({ 
    ok: true, 
    message: 'Altegio webhook endpoint is active',
    timestamp: new Date().toISOString(),
  });
}
