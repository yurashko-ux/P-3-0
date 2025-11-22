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
    
    // Перевіряємо, чи вказано ID компанії (салону) або ID мережі в environment variables
    const companyId = process.env.ALTEGIO_COMPANY_ID;
    let companies: any[] = [];
    
    if (companyId) {
      const companyIdNum = parseInt(companyId, 10);
      if (!isNaN(companyIdNum)) {
        try {
          const { getCompany, getCompaniesByGroup } = await import('@/lib/altegio/companies');
          
          // Спочатку спробуємо отримати компанію як філію (салон)
          let userCompany = await getCompany(companyIdNum);
          
          // Якщо отримали компанію, перевіримо чи це мережа (є business_group_id або main_group_id)
          if (userCompany) {
            const groupId = (userCompany as any).business_group_id || (userCompany as any).main_group_id;
            
            // Якщо це мережа (є group_id), спробуємо отримати філії цієї мережі
            if (groupId) {
              console.log(`[altegio/test] Company ${companyId} is a network with group_id ${groupId}, getting branches...`);
              const branches = await getCompaniesByGroup(groupId);
              if (branches.length > 0) {
                companies = branches;
                console.log(`[altegio/test] Found ${branches.length} branches in network ${companyId}`);
              } else {
                // Якщо не знайшли філії, показуємо саму мережу
                companies = [userCompany];
                console.log(`[altegio/test] Network ${companyId} has no branches, showing network itself`);
              }
            } else {
              // Якщо це філія (салон), показуємо її
              companies = [userCompany];
              console.log(`[altegio/test] Found company by ALTEGIO_COMPANY_ID ${companyId}:`, userCompany);
            }
          } else {
            console.warn(`[altegio/test] Company with ID ${companyId} not found, falling back to list`);
          }
        } catch (err) {
          console.warn(`[altegio/test] Failed to get company by ID ${companyId}, falling back to list:`, err);
        }
      }
    }
    
    // Якщо не знайшли за ALTEGIO_COMPANY_ID, отримуємо всі компанії
    if (companies.length === 0) {
      companies = await getCompanies();
      console.log(`[altegio/test] Got ${companies.length} companies ${companyId ? `(ALTEGIO_COMPANY_ID ${companyId} not found)` : '(ALTEGIO_COMPANY_ID not set)'}`);
    }
    
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

