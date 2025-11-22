// web/app/api/altegio/test/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCompanies } from '@/lib/altegio/companies';
import { assertAltegioEnv } from '@/lib/altegio/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    // Діагностика: перевіряємо змінні середовища
    const hasPartnerToken = !!process.env.ALTEGIO_PARTNER_TOKEN;
    const hasUserToken = !!process.env.ALTEGIO_USER_TOKEN;
    const programType = hasPartnerToken ? 'Public (with Partner Token)' : 'Non-public (User Token only)';
    
    const envCheck = {
      apiUrl: process.env.ALTEGIO_API_URL || 'https://api.alteg.io/api/v1',
      programType,
      hasUserToken,
      userTokenLength: process.env.ALTEGIO_USER_TOKEN?.length || 0,
      hasPartnerToken,
      partnerTokenValue: process.env.ALTEGIO_PARTNER_TOKEN ? String(process.env.ALTEGIO_PARTNER_TOKEN).substring(0, 10) + '...' : 'not set',
      partnerTokenLength: process.env.ALTEGIO_PARTNER_TOKEN?.length || 0,
      hasApplicationId: !!process.env.ALTEGIO_APPLICATION_ID,
      applicationIdValue: process.env.ALTEGIO_APPLICATION_ID || 'not set',
      applicationIdLength: process.env.ALTEGIO_APPLICATION_ID?.length || 0,
      hasPartnerId: !!process.env.ALTEGIO_PARTNER_ID,
      partnerIdValue: process.env.ALTEGIO_PARTNER_ID || 'not set',
      partnerIdLength: process.env.ALTEGIO_PARTNER_ID?.length || 0,
    };
    
    console.log('[altegio/test] Environment check:', envCheck);
    
    assertAltegioEnv();
    
    // Спробуємо використати Partner ID як ID філії для фільтрації
    // Partner ID (784) може бути ID салону, але якщо ні - покажемо всі компанії
    const partnerId = process.env.ALTEGIO_PARTNER_ID;
    const partnerIdNum = partnerId ? parseInt(partnerId, 10) : null;
    
    // Перевіряємо, чи Partner ID - це числовий ID компанії
    // Якщо так, спробуємо отримати тільки цю компанію
    const companies = await getCompanies(
      partnerIdNum && !isNaN(partnerIdNum) ? partnerIdNum : undefined
    );
    
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
    const hasPartnerToken = !!process.env.ALTEGIO_PARTNER_TOKEN;
    const hasUserToken = !!process.env.ALTEGIO_USER_TOKEN;
    const hasPartnerId = !!process.env.ALTEGIO_PARTNER_ID;
    const programType = hasPartnerToken ? 'Public (with Partner Token)' : 'Non-public (User Token only)';
    
    const envCheck = {
      programType,
      hasUserToken,
      hasPartnerToken,
      partnerTokenValue: process.env.ALTEGIO_PARTNER_TOKEN ? String(process.env.ALTEGIO_PARTNER_TOKEN).substring(0, 10) + '...' : 'not set',
      partnerTokenLength: process.env.ALTEGIO_PARTNER_TOKEN?.length || 0,
      hasApplicationId: !!process.env.ALTEGIO_APPLICATION_ID,
      applicationIdValue: process.env.ALTEGIO_APPLICATION_ID || 'not set',
      applicationIdLength: process.env.ALTEGIO_APPLICATION_ID?.length || 0,
      hasPartnerId,
      partnerIdValue: process.env.ALTEGIO_PARTNER_ID || 'not set',
      partnerIdLength: process.env.ALTEGIO_PARTNER_ID?.length || 0,
    };
    
    // Перевіряємо, чи помилка пов'язана з Partner ID
    const isPartnerIdError = errorMessage.includes('Partner ID') || errorMessage.includes('partner') || errorMessage.includes('401');
    
    // Для публічних програм (з Partner Token) потрібні обидва токени
    const hintForPublic = hasPartnerToken && (!hasUserToken || isPartnerIdError)
      ? 'Для публічних програм потрібні обидва токени: ALTEGIO_PARTNER_TOKEN та ALTEGIO_USER_TOKEN. Переконайтеся, що обидва встановлені правильно.'
      : null;
    
    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
        hint: hintForPublic || (isPartnerIdError 
          ? (hasPartnerToken 
            ? 'Для публічних програм потрібні ALTEGIO_PARTNER_TOKEN та ALTEGIO_USER_TOKEN. Перевірте, чи обидва встановлені правильно.'
            : 'Потрібен ALTEGIO_PARTNER_TOKEN (для публічних програм) або видаліть його (для непублічних програм). Перевірте, чи змінна додана для правильного середовища (Production/Preview) та чи перезапущено деплой.')
          : 'Перевірте, чи правильно налаштовано ALTEGIO_USER_TOKEN у змінних середовища Vercel.'),
        programType,
        needsPartnerToken: isPartnerIdError && !hasPartnerToken,
        recommendation: isPartnerIdError && !hasPartnerId && hasUserToken && !hasPartnerToken
          ? 'Для непублічної програми: додайте ALTEGIO_PARTNER_ID (ID вашої філії/салону в Alteg.io, наприклад: 1169323) в Vercel environment variables'
          : (hasPartnerToken && isPartnerIdError && hasUserToken
            ? 'Для непублічної програми: видаліть ALTEGIO_PARTNER_TOKEN з Vercel і використовуйте тільки ALTEGIO_USER_TOKEN + ALTEGIO_PARTNER_ID'
            : null),
        env: envCheck,
        debug: {
          partnerTokenInEnv: hasPartnerToken,
          partnerTokenLength: process.env.ALTEGIO_PARTNER_TOKEN?.length || 0,
          partnerIdInEnv: hasPartnerId,
          partnerIdValue: process.env.ALTEGIO_PARTNER_ID ? String(process.env.ALTEGIO_PARTNER_ID).substring(0, 15) + '...' : 'not set',
          partnerIdLength: process.env.ALTEGIO_PARTNER_ID?.length || 0,
          userTokenInEnv: hasUserToken,
          userTokenLength: process.env.ALTEGIO_USER_TOKEN?.length || 0,
        },
      },
      { status: 500 }
    );
  }
}

