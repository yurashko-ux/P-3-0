// web/app/api/altegio/webhook/route.ts
// Webhook endpoint для отримання подій від Alteg.io

import { NextRequest, NextResponse } from 'next/server';
import { kvWrite } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Webhook endpoint для отримання подій від Alteg.io
 * 
 * Alteg.io надсилає webhook при різних подіях:
 * - Створення/оновлення клієнтів
 * - Створення/оновлення записів
 * - Зміни в товарах/послугах
 * - Інші події
 * 
 * URL для налаштування: https://your-domain.vercel.app/api/altegio/webhook
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    
    // Перетворюємо Headers в об'єкт
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    // Зберігаємо останній webhook для діагностики
    const timestamp = Date.now();
    const webhookData = {
      timestamp,
      headers,
      body,
      received_at: new Date().toISOString(),
    };
    
    // Зберігаємо в KV для перегляду в адмінці
    await kvWrite.setRaw('altegio:last-webhook', JSON.stringify(webhookData));
    
    console.log('[altegio/webhook] Received webhook:', {
      timestamp,
      type: body.type || body.event || 'unknown',
      company_id: body.company_id || body.companyId,
      event: body.event || body.type,
    });
    
    // Обробка різних типів подій
    const eventType = body.type || body.event || 'unknown';
    
    switch (eventType) {
      case 'client.created':
      case 'client.updated':
        // Подія по клієнту
        await handleClientEvent(body);
        break;
        
      case 'appointment.created':
      case 'appointment.updated':
        // Подія по запису
        await handleAppointmentEvent(body);
        break;
        
      case 'company.updated':
        // Подія по компанії
        await handleCompanyEvent(body);
        break;
        
      default:
        console.log('[altegio/webhook] Unknown event type:', eventType);
    }
    
    // Повертаємо успішну відповідь
    return NextResponse.json({
      ok: true,
      received: true,
      event_type: eventType,
      timestamp,
    });
  } catch (err) {
    console.error('[altegio/webhook] Error processing webhook:', err);
    
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
 * Обробка подій по клієнтам
 */
async function handleClientEvent(data: any) {
  console.log('[altegio/webhook] Client event:', {
    client_id: data.client_id || data.clientId,
    action: data.action || data.type,
  });
  
  // Тут буде логіка обробки подій по клієнтах
  // Наприклад: синхронізація з нашою БД
}

/**
 * Обробка подій по записах
 */
async function handleAppointmentEvent(data: any) {
  console.log('[altegio/webhook] Appointment event:', {
    appointment_id: data.appointment_id || data.appointmentId,
    action: data.action || data.type,
  });
  
  // Тут буде логіка обробки подій по записах
  // Наприклад: синхронізація з нашою БД
}

/**
 * Обробка подій по компаніях
 */
async function handleCompanyEvent(data: any) {
  console.log('[altegio/webhook] Company event:', {
    company_id: data.company_id || data.companyId,
    action: data.action || data.type,
  });
  
  // Тут буде логіка обробки подій по компаніях
}

