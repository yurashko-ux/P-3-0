// web/app/api/altegio/test/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCompanies } from '@/lib/altegio/companies';
import { assertAltegioEnv } from '@/lib/altegio/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    // Діагностика: перевіряємо змінні середовища
    const envCheck = {
      apiUrl: process.env.ALTEGIO_API_URL || 'https://api.alteg.io/api/v1',
      hasUserToken: !!process.env.ALTEGIO_USER_TOKEN,
      userTokenLength: process.env.ALTEGIO_USER_TOKEN?.length || 0,
      hasPartnerToken: !!process.env.ALTEGIO_PARTNER_TOKEN,
      partnerTokenValue: process.env.ALTEGIO_PARTNER_TOKEN ? String(process.env.ALTEGIO_PARTNER_TOKEN).substring(0, 10) + '...' : 'not set',
      partnerTokenLength: process.env.ALTEGIO_PARTNER_TOKEN?.length || 0,
    };
    
    console.log('[altegio/test] Environment check:', envCheck);
    
    assertAltegioEnv();
    
    const companies = await getCompanies();
    
    return NextResponse.json({
      ok: true,
      companies,
      count: companies.length,
      message: 'Altegio API connection successful',
      env: envCheck,
    });
  } catch (err) {
    console.error('[altegio/test] Error:', err);
    
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    // Діагностика змінних середовища
    const envCheck = {
      hasUserToken: !!process.env.ALTEGIO_USER_TOKEN,
      hasPartnerToken: !!process.env.ALTEGIO_PARTNER_TOKEN,
      partnerTokenValue: process.env.ALTEGIO_PARTNER_TOKEN || 'not set',
    };
    
    // Перевіряємо, чи помилка пов'язана з Partner ID
    const isPartnerIdError = errorMessage.includes('Partner ID') || errorMessage.includes('partner') || errorMessage.includes('401');
    const hasPartnerToken = !!process.env.ALTEGIO_PARTNER_TOKEN;
    const hasUserToken = !!process.env.ALTEGIO_USER_TOKEN;
    
    // Для непублічних програм Partner Token не потрібен
    // Якщо є Partner Token і помилка "Partner ID not specified", можливо потрібно видалити Partner Token
    const hintForNonPublic = hasPartnerToken && isPartnerIdError
      ? 'Для непублічних програм Partner Token не потрібен. Видаліть ALTEGIO_PARTNER_TOKEN з Vercel environment variables та використовуйте тільки ALTEGIO_USER_TOKEN.'
      : null;
    
    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
        hint: hintForNonPublic || (isPartnerIdError 
          ? 'Потрібен ALTEGIO_PARTNER_TOKEN (для публічних програм) або видаліть його (для непублічних програм). Перевірте, чи змінна додана для правильного середовища (Production/Preview) та чи перезапущено деплой.'
          : 'Перевірте, чи правильно налаштовано ALTEGIO_USER_TOKEN у змінних середовища Vercel.'),
        needsPartnerToken: isPartnerIdError && !hasPartnerToken,
        programType: hasPartnerToken ? 'Public (with Partner Token)' : 'Non-public (User Token only)',
        recommendation: hasPartnerToken && isPartnerIdError && hasUserToken
          ? 'Для непублічної програми: видаліть ALTEGIO_PARTNER_TOKEN з Vercel і використовуйте тільки ALTEGIO_USER_TOKEN'
          : null,
        env: envCheck,
        debug: {
          partnerTokenInEnv: hasPartnerToken,
          partnerTokenLength: process.env.ALTEGIO_PARTNER_TOKEN?.length || 0,
          userTokenInEnv: hasUserToken,
          userTokenLength: process.env.ALTEGIO_USER_TOKEN?.length || 0,
        },
      },
      { status: 500 }
    );
  }
}

