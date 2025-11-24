// web/app/api/altegio/diagnostics/route.ts
// Endpoint для збору діагностичної інформації для техпідтримки Altegio

import { NextRequest, NextResponse } from 'next/server';
import { altegioHeaders, ALTEGIO_ENV } from '@/lib/altegio/env';
import { altegioUrl } from '@/lib/altegio/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Збирає діагностичну інформацію для техпідтримки Altegio
 */
export async function GET(req: NextRequest) {
  try {
    const companyId = process.env.ALTEGIO_COMPANY_ID || '1169323';
    
    // Формуємо заголовки
    const headers = altegioHeaders();
    
    // Формуємо URL для тестового запиту
    const testUrl = altegioUrl(`/company/${companyId}/clients`);
    
    // Формуємо повний Authorization header для показу (з частковим USER_TOKEN)
    let authorizationHeaderFull = 'not set';
    if (headers.Authorization) {
      const authHeader = headers.Authorization;
      // Показуємо повний header, але з частковим USER_TOKEN для безпеки
      if (authHeader.includes('User ')) {
        const parts = authHeader.split('User ');
        if (parts.length === 2) {
          const userToken = parts[1];
          // Показуємо перші 10 і останні 4 символи USER_TOKEN
          const userTokenPreview = userToken.length > 14 
            ? `${userToken.substring(0, 10)}...${userToken.substring(userToken.length - 4)}`
            : userToken.substring(0, 10) + '...';
          authorizationHeaderFull = `${parts[0]}User ${userTokenPreview}`;
        } else {
          authorizationHeaderFull = authHeader.substring(0, 100) + '...';
        }
      } else {
        authorizationHeaderFull = authHeader.substring(0, 100) + '...';
      }
    }

    // Збираємо всю діагностичну інформацію
    const diagnostics = {
      timestamp: new Date().toISOString(),
      environment: {
        hasUserToken: !!ALTEGIO_ENV.USER_TOKEN,
        userTokenLength: ALTEGIO_ENV.USER_TOKEN?.length || 0,
        userTokenPreview: ALTEGIO_ENV.USER_TOKEN 
          ? `${ALTEGIO_ENV.USER_TOKEN.substring(0, 10)}...${ALTEGIO_ENV.USER_TOKEN.substring(ALTEGIO_ENV.USER_TOKEN.length - 4)}`
          : 'not set',
        hasPartnerToken: !!ALTEGIO_ENV.PARTNER_TOKEN,
        partnerTokenLength: ALTEGIO_ENV.PARTNER_TOKEN?.length || 0,
        partnerTokenPreview: ALTEGIO_ENV.PARTNER_TOKEN 
          ? `${ALTEGIO_ENV.PARTNER_TOKEN.substring(0, 10)}...${ALTEGIO_ENV.PARTNER_TOKEN.substring(ALTEGIO_ENV.PARTNER_TOKEN.length - 4)}`
          : 'not set',
        partnerTokenFull: ALTEGIO_ENV.PARTNER_TOKEN || 'not set', // Повний PARTNER_TOKEN (він не секретний)
        hasApplicationId: !!ALTEGIO_ENV.APPLICATION_ID,
        applicationId: ALTEGIO_ENV.APPLICATION_ID || 'not set',
        hasPartnerId: !!ALTEGIO_ENV.PARTNER_ID,
        partnerId: ALTEGIO_ENV.PARTNER_ID || 'not set',
        companyId: companyId,
        apiUrl: ALTEGIO_ENV.API_URL,
      },
      headers: {
        accept: headers.Accept,
        contentType: headers['Content-Type'],
        authorization: authorizationHeaderFull,
        authorizationFormat: headers.Authorization 
          ? (headers.Authorization.includes('User ') 
              ? 'Bearer <PARTNER_TOKEN>, User <USER_TOKEN>' 
              : 'Bearer <USER_TOKEN>')
          : 'not set',
        xPartnerId: headers['X-Partner-ID'] || 'not set',
        xApplicationId: headers['X-Application-ID'] || 'not set',
        partnerId: headers['Partner-ID'] || 'not set',
        allHeaderKeys: Object.keys(headers),
      },
      tokenExplanation: {
        partnerToken: ALTEGIO_ENV.PARTNER_TOKEN 
          ? `Bearer token (${ALTEGIO_ENV.PARTNER_TOKEN}) - це ALTEGIO_PARTNER_TOKEN з environment variables`
          : 'PARTNER_TOKEN не встановлено',
        userToken: ALTEGIO_ENV.USER_TOKEN
          ? `User token (${ALTEGIO_ENV.USER_TOKEN.substring(0, 10)}...${ALTEGIO_ENV.USER_TOKEN.substring(ALTEGIO_ENV.USER_TOKEN.length - 4)}) - це ALTEGIO_USER_TOKEN з environment variables`
          : 'USER_TOKEN не встановлено',
        note: 'USER_TOKEN показується частково для безпеки, але він використовується в Authorization header',
      },
      testRequest: {
        url: testUrl,
        method: 'POST',
        endpoint: `/company/${companyId}/clients`,
      },
      recommendations: [
        'Перевірте, чи USER_TOKEN має права доступу до компанії в Altegio',
        ALTEGIO_ENV.APPLICATION_ID 
          ? `Перевірте, чи Application ID (${ALTEGIO_ENV.APPLICATION_ID}) правильний для вашої непублічної програми`
          : 'Перевірте, чи Application ID встановлено в environment variables',
        companyId !== '1169323' || ALTEGIO_ENV.PARTNER_ID
          ? `Перевірте, чи Company ID (${companyId}) та Partner ID (${ALTEGIO_ENV.PARTNER_ID || 'not set'}) правильні для вашої філії`
          : 'Перевірте, чи Company ID та Partner ID правильні для вашої філії',
        'Можливо, потрібно надати додаткові права користувачу в Altegio',
        'Спробуйте перегенерувати USER_TOKEN в Altegio Marketplace',
      ],
    };
    
    return NextResponse.json({
      ok: true,
      diagnostics,
      note: 'Ця інформація може бути корисна для техпідтримки Altegio',
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

