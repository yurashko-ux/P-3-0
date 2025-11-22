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
    
    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
        hint: isPartnerIdError 
          ? 'Потрібен ALTEGIO_PARTNER_TOKEN. Перевірте, чи змінна додана для правильного середовища (Production/Preview) та чи перезапущено деплой.'
          : 'Перевірте, чи правильно налаштовано ALTEGIO_USER_TOKEN та ALTEGIO_PARTNER_TOKEN у змінних середовища Vercel.',
        needsPartnerToken: isPartnerIdError,
        env: envCheck,
        debug: {
          partnerTokenInEnv: !!process.env.ALTEGIO_PARTNER_TOKEN,
          partnerTokenLength: process.env.ALTEGIO_PARTNER_TOKEN?.length || 0,
        },
      },
      { status: 500 }
    );
  }
}

