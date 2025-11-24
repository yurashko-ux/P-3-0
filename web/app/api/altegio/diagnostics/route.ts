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
    
    // Збираємо всю діагностичну інформацію
    const diagnostics = {
      timestamp: new Date().toISOString(),
      environment: {
        hasUserToken: !!ALTEGIO_ENV.USER_TOKEN,
        userTokenLength: ALTEGIO_ENV.USER_TOKEN?.length || 0,
        userTokenPreview: ALTEGIO_ENV.USER_TOKEN ? ALTEGIO_ENV.USER_TOKEN.substring(0, 10) + '...' : 'not set',
        hasPartnerToken: !!ALTEGIO_ENV.PARTNER_TOKEN,
        partnerTokenLength: ALTEGIO_ENV.PARTNER_TOKEN?.length || 0,
        partnerTokenPreview: ALTEGIO_ENV.PARTNER_TOKEN ? ALTEGIO_ENV.PARTNER_TOKEN.substring(0, 10) + '...' : 'not set',
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
        authorization: headers.Authorization ? headers.Authorization.substring(0, 80) + '...' : 'not set',
        xPartnerId: headers['X-Partner-ID'] || 'not set',
        partnerId: headers['Partner-ID'] || 'not set',
        allHeaderKeys: Object.keys(headers),
      },
      testRequest: {
        url: testUrl,
        method: 'POST',
        endpoint: `/company/${companyId}/clients`,
      },
      recommendations: [
        'Перевірте, чи USER_TOKEN має права доступу до компанії в Altegio',
        'Перевірте, чи Application ID (1195) правильний для вашої непублічної програми',
        'Перевірте, чи Company ID (1169323) правильний для вашої філії',
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

