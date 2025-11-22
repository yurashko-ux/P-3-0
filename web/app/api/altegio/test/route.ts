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
    
    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
        hint: 'Перевірте, чи правильно налаштовано ALTEGIO_USER_TOKEN у змінних середовища',
      },
      { status: 500 }
    );
  }
}

