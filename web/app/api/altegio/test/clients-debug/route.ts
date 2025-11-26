// web/app/api/altegio/test/clients-debug/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAltegioEnv, altegioHeaders, altegioUrl } from '@/lib/altegio/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Діагностичний endpoint для тестування всіх можливих варіантів отримання клієнтів
 */
export async function GET(req: NextRequest) {
  try {
    assertAltegioEnv();
    
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '1169323';
    const companyId = parseInt(companyIdStr, 10);
    
    const results: any[] = [];
    
    // Спочатку перевіримо, чи працює отримання компанії
    console.log(`[altegio/test/clients-debug] Testing company ${companyId}...`);
    
    try {
      const companyUrl = altegioUrl(`/company/${companyId}`);
      const companyResponse = await fetch(companyUrl, {
        method: 'GET',
        headers: altegioHeaders(),
      });
      
      const companyData = await companyResponse.json().catch(() => ({}));
      
      results.push({
        test: 'GET /company/{id}',
        url: companyUrl,
        status: companyResponse.status,
        statusText: companyResponse.statusText,
        success: companyResponse.ok,
        data: companyData,
      });
      
      console.log(`[altegio/test/clients-debug] Company test:`, {
        status: companyResponse.status,
        ok: companyResponse.ok,
        hasData: !!companyData,
      });
    } catch (err) {
      results.push({
        test: 'GET /company/{id}',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    
    // Тестуємо різні варіанти отримання клієнтів
    const clientTests = [
      {
        name: 'GET /company/{id}/clients',
        method: 'GET',
        url: `/company/${companyId}/clients`,
        body: undefined,
      },
      {
        name: 'GET /clients?company_id={id}',
        method: 'GET',
        url: `/clients?company_id=${companyId}`,
        body: undefined,
      },
      {
        name: 'POST /clients with company_id in body',
        method: 'POST',
        url: `/clients`,
        body: JSON.stringify({ company_id: companyId }),
      },
      {
        name: 'POST /company/{id}/clients with empty body',
        method: 'POST',
        url: `/company/${companyId}/clients`,
        body: JSON.stringify({}),
      },
      {
        name: 'GET /clients (without company_id)',
        method: 'GET',
        url: `/clients`,
        body: undefined,
      },
    ];
    
    for (const test of clientTests) {
      try {
        const fullUrl = altegioUrl(test.url);
        const headers = altegioHeaders();
        
        const options: RequestInit = {
          method: test.method,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
        };
        
        if (test.body) {
          options.body = test.body;
        }
        
        console.log(`[altegio/test/clients-debug] Testing: ${test.name}`, {
          url: fullUrl,
          method: test.method,
          hasBody: !!test.body,
        });
        
        const response = await fetch(fullUrl, options);
        const responseText = await response.text();
        let responseData: any;
        
        try {
          responseData = JSON.parse(responseText);
        } catch {
          responseData = responseText;
        }
        
        results.push({
          test: test.name,
          url: fullUrl,
          method: test.method,
          status: response.status,
          statusText: response.statusText,
          success: response.ok,
          headers: Object.fromEntries(response.headers.entries()),
          body: test.body,
          response: responseData,
        });
        
        console.log(`[altegio/test/clients-debug] Result for ${test.name}:`, {
          status: response.status,
          ok: response.ok,
          responseKeys: responseData && typeof responseData === 'object' ? Object.keys(responseData) : [],
        });
      } catch (err) {
        results.push({
          test: test.name,
          url: test.url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    
    return NextResponse.json({
      ok: true,
      companyId,
      results,
      summary: {
        totalTests: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success && !r.error).length,
        errors: results.filter(r => r.error).length,
      },
    });
  } catch (err) {
    console.error('[altegio/test/clients-debug] Error:', err);
    
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

