// web/app/api/admin/direct/check-telegram-webhook/route.ts
// Перевірка налаштування Telegram webhook для HOB_client_bot

import { NextRequest, NextResponse } from 'next/server';
import { TELEGRAM_ENV } from '@/lib/telegram/env';

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
 * GET - перевірити налаштування Telegram webhook
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const hobClientBotToken = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN;
    const botToken = TELEGRAM_ENV.BOT_TOKEN;
    
    const results: any = {
      tokens: {
        HOB_CLIENT_BOT_TOKEN: hobClientBotToken ? `${hobClientBotToken.substring(0, 10)}...` : 'NOT SET',
        BOT_TOKEN: botToken ? `${botToken.substring(0, 10)}...` : 'NOT SET',
      },
      webhooks: {} as any,
    };

    // Перевіряємо webhook для HOB_client_bot
    if (hobClientBotToken) {
      try {
        const webhookUrl = `https://api.telegram.org/bot${hobClientBotToken}/getWebhookInfo`;
        const response = await fetch(webhookUrl);
        const data = await response.json();
        
        results.webhooks.HOB_CLIENT_BOT = {
          ok: data.ok,
          url: data.result?.url || 'NOT SET',
          hasCustomCertificate: data.result?.has_custom_certificate || false,
          pendingUpdateCount: data.result?.pending_update_count || 0,
          lastErrorDate: data.result?.last_error_date || null,
          lastErrorMessage: data.result?.last_error_message || null,
          maxConnections: data.result?.max_connections || null,
          allowedUpdates: data.result?.allowed_updates || [],
          error: data.error_code ? {
            code: data.error_code,
            description: data.description,
          } : null,
        };
      } catch (err) {
        results.webhooks.HOB_CLIENT_BOT = {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      results.webhooks.HOB_CLIENT_BOT = {
        error: 'HOB_CLIENT_BOT_TOKEN not set',
      };
    }

    // Перевіряємо webhook для основного бота
    let mainBotWebhookUrl = '';
    if (botToken) {
      try {
        const webhookUrl = `https://api.telegram.org/bot${botToken}/getWebhookInfo`;
        const response = await fetch(webhookUrl);
        const data = await response.json();
        
        mainBotWebhookUrl = data.result?.url || '';
        
        results.webhooks.BOT = {
          ok: data.ok,
          url: mainBotWebhookUrl,
          hasCustomCertificate: data.result?.has_custom_certificate || false,
          pendingUpdateCount: data.result?.pending_update_count || 0,
          lastErrorDate: data.result?.last_error_date || null,
          lastErrorMessage: data.result?.last_error_message || null,
          maxConnections: data.result?.max_connections || null,
          allowedUpdates: data.result?.allowed_updates || [],
          error: data.error_code ? {
            code: data.error_code,
            description: data.description,
          } : null,
        };
      } catch (err) {
        results.webhooks.BOT = {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      results.webhooks.BOT = {
        error: 'BOT_TOKEN not set',
      };
    }
    
    // Зберігаємо значення bypass для використання в POST
    results._bypassValue = (() => {
      // Спробуємо витягти з URL основного бота
      if (mainBotWebhookUrl) {
        const urlObj = new URL(mainBotWebhookUrl);
        const bypass = urlObj.searchParams.get('x-vercel-protection-bypass');
        if (bypass) return bypass;
      }
      // Або з env змінних
      return process.env.X_VERCEL_PROTECTION_BYPASS || 
             process.env.VERCEL_PROTECTION_BYPASS || 
             null;
    })();

    return NextResponse.json({
      ok: true,
      ...results,
    });
  } catch (error) {
    console.error('[direct/check-telegram-webhook] Error:', error);
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
 * POST - налаштувати webhook для HOB_client_bot
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    let webhookUrl = body.url;
    
    if (!webhookUrl) {
      return NextResponse.json({ 
        ok: false, 
        error: 'URL is required' 
      }, { status: 400 });
    }

    // Додаємо параметр Vercel Protection Bypass
    // Спочатку пробуємо отримати з URL основного бота
    let bypassValue = null;
    
    try {
      const botToken = TELEGRAM_ENV.BOT_TOKEN;
      if (botToken) {
        const webhookInfoUrl = `https://api.telegram.org/bot${botToken}/getWebhookInfo`;
        const infoResponse = await fetch(webhookInfoUrl);
        const infoData = await infoResponse.json();
        const mainBotUrl = infoData.result?.url || '';
        
        if (mainBotUrl) {
          const urlObj = new URL(mainBotUrl);
          bypassValue = urlObj.searchParams.get('x-vercel-protection-bypass');
        }
      }
    } catch (err) {
      console.warn('[direct/check-telegram-webhook] Failed to get bypass from main bot:', err);
    }
    
    // Якщо не знайшли в URL основного бота, пробуємо env змінні
    if (!bypassValue) {
      bypassValue = 
        process.env.X_VERCEL_PROTECTION_BYPASS || 
        process.env.VERCEL_PROTECTION_BYPASS ||
        req.headers.get('x-vercel-protection-bypass') ||
        null;
    }
    
    // Додаємо параметр до URL, якщо він є і ще не доданий
    if (bypassValue && !webhookUrl.includes('x-vercel-protection-bypass')) {
      const separator = webhookUrl.includes('?') ? '&' : '?';
      webhookUrl = `${webhookUrl}${separator}x-vercel-protection-bypass=${encodeURIComponent(bypassValue)}`;
      console.log(`[direct/check-telegram-webhook] Added bypass parameter to URL: ${webhookUrl.substring(0, 100)}...`);
    } else if (!bypassValue) {
      console.warn('[direct/check-telegram-webhook] No bypass value found, webhook may fail with 401');
    }

    const hobClientBotToken = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN;
    
    if (!hobClientBotToken) {
      return NextResponse.json({
        ok: false,
        error: 'HOB_CLIENT_BOT_TOKEN not set',
      }, { status: 400 });
    }

    // Налаштовуємо webhook
    const setWebhookUrl = `https://api.telegram.org/bot${hobClientBotToken}/setWebhook`;
    const response = await fetch(setWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
      }),
    });

    const data = await response.json();

    if (data.ok) {
      return NextResponse.json({
        ok: true,
        message: 'Webhook налаштовано успішно',
        webhookUrl,
        result: data.result,
      });
    } else {
      return NextResponse.json({
        ok: false,
        error: data.description || 'Failed to set webhook',
        errorCode: data.error_code,
      }, { status: 400 });
    }
  } catch (error) {
    console.error('[direct/check-telegram-webhook] Error setting webhook:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

