// web/app/api/altegio/test/clients/[clientId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '@/lib/altegio/clients';
import { assertAltegioEnv } from '@/lib/altegio/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Endpoint для отримання повної структури конкретного клієнта
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { clientId: string } }
) {
  try {
    assertAltegioEnv();
    
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID;
    if (!companyIdStr) {
      return NextResponse.json(
        { 
          ok: false, 
          error: 'ALTEGIO_COMPANY_ID not set in environment variables' 
        },
        { status: 400 }
      );
    }
    
    const companyId = parseInt(companyIdStr, 10);
    const clientId = parseInt(params.clientId, 10);
    
    if (isNaN(companyId) || isNaN(clientId)) {
      return NextResponse.json(
        { 
          ok: false, 
          error: `Invalid company ID (${companyIdStr}) or client ID (${params.clientId})` 
        },
        { status: 400 }
      );
    }
    
    console.log(`[altegio/test/clients/${clientId}] Fetching full structure for client ${clientId}...`);
    
    // Спочатку спробуємо отримати клієнта з усіма полями через прямий виклик API
    const { altegioFetch } = await import('@/lib/altegio/client');
    let fullClientData: any = null;
    
    try {
      // Пробуємо отримати з усіма полями
      const fullResponse = await altegioFetch<any>(`/company/${companyId}/client/${clientId}?fields[]=*&include[]=*`);
      if (fullResponse && typeof fullResponse === 'object') {
        fullClientData = 'data' in fullResponse ? fullResponse.data : fullResponse;
        console.log(`[altegio/test/clients/${clientId}] Got full client data with keys:`, Object.keys(fullClientData || {}));
      }
    } catch (err) {
      console.warn(`[altegio/test/clients/${clientId}] Failed to get full client data:`, err);
    }
    
    const client = await getClient(companyId, clientId);
    
    if (!client) {
      return NextResponse.json({
        ok: false,
        error: `Client with ID ${clientId} not found`,
        clientId,
        companyId,
      }, { status: 404 });
    }
    
    // Повна структура клієнта
    const allKeys = Object.keys(client);
    const standardFields = ['id', 'name', 'phone', 'email', 'created_at', 'updated_at', 'company_id'];
    const customFields = allKeys.filter(key => !standardFields.includes(key));
    
    // Шукаємо поля, пов'язані з візитами та сумами
    const visitRelatedFields: Record<string, any> = {};
    const amountRelatedFields: Record<string, any> = {};
    const allClientData = fullClientData || client;
    
    if (allClientData) {
      Object.keys(allClientData).forEach(key => {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('visit') || lowerKey.includes('візит')) {
          visitRelatedFields[key] = allClientData[key];
        }
        if (lowerKey.includes('amount') || lowerKey.includes('spent') || lowerKey.includes('total') || 
            lowerKey.includes('сума') || lowerKey.includes('сум')) {
          amountRelatedFields[key] = allClientData[key];
        }
      });
    }
    
    return NextResponse.json({
      ok: true,
      clientId,
      companyId,
      client: {
        ...client,
        // Додаємо мета-інформацію
        _meta: {
          allKeys,
          customFields,
          hasCustomFields: !!client.custom_fields,
          customFieldsKeys: client.custom_fields ? Object.keys(client.custom_fields) : [],
        },
      },
      // Повна raw структура для діагностики
      rawStructure: JSON.stringify(client, null, 2),
      // Повна структура з усіма полями (якщо отримали)
      fullClientData: fullClientData ? JSON.stringify(fullClientData, null, 2) : null,
      // Поля, пов'язані з візитами
      visitRelatedFields,
      // Поля, пов'язані з сумами
      amountRelatedFields,
      // Детальна інформація про custom_fields
      customFieldsData: client.custom_fields || null,
      note: 'Використовуй fullClientData або rawStructure для повного перегляду всіх полів. visitRelatedFields та amountRelatedFields показують релевантні поля.',
    });
  } catch (err) {
    console.error(`[altegio/test/clients/${params.clientId}] Error:`, err);
    
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
        clientId: params.clientId,
      },
      { status: 500 }
    );
  }
}

