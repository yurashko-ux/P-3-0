// web/app/api/altegio/test/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCompanies } from '@/lib/altegio/companies';
import { assertAltegioEnv } from '@/lib/altegio/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    assertAltegioEnv();
    
    const companies = await getCompanies();
    
    return NextResponse.json({
      ok: true,
      companies,
      count: companies.length,
      message: 'Altegio API connection successful',
      env: {
        apiUrl: process.env.ALTEGIO_API_URL || 'https://api.alteg.io/api/v1',
        hasUserToken: !!process.env.ALTEGIO_USER_TOKEN,
        hasPartnerToken: !!process.env.ALTEGIO_PARTNER_TOKEN,
      },
    });
  } catch (err) {
    console.error('[altegio/test] Error:', err);
    
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    // Перевіряємо, чи помилка пов'язана з Partner ID
    const isPartnerIdError = errorMessage.includes('Partner ID') || errorMessage.includes('partner') || errorMessage.includes('401');
    
    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
        hint: isPartnerIdError 
          ? 'Потрібен ALTEGIO_PARTNER_TOKEN. Його можна знайти в налаштуваннях додатку на маркетплейсі Alteg.io (розділ "Загальна інформація" або "Доступ до API").'
          : 'Перевірте, чи правильно налаштовано ALTEGIO_USER_TOKEN та ALTEGIO_PARTNER_TOKEN у змінних середовища Vercel.',
        needsPartnerToken: isPartnerIdError,
      },
      { status: 500 }
    );
  }
}

