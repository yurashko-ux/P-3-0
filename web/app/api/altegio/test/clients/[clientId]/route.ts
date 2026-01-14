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
    let apiError: any = null;
    
    // Пробуємо різні варіанти запитів
    const apiAttempts = [
      `/company/${companyId}/client/${clientId}?fields[]=*&include[]=*`,
      `/company/${companyId}/client/${clientId}?fields[]=id&fields[]=name&fields[]=phone&fields[]=email&fields[]=success_visits_count&fields[]=total_spent&fields[]=visits_count`,
      `/company/${companyId}/client/${clientId}`,
    ];
    
    const apiErrorsList: any[] = [];
    for (let i = 0; i < apiAttempts.length; i++) {
      const url = apiAttempts[i];
      try {
        console.log(`[altegio/test/clients/${clientId}] Trying API attempt ${i + 1}/${apiAttempts.length}: ${url}`);
        const fullResponse = await altegioFetch<any>(url);
        if (fullResponse && typeof fullResponse === 'object') {
          fullClientData = 'data' in fullResponse ? fullResponse.data : fullResponse;
          if (fullClientData && (fullClientData.id || fullClientData.client_id)) {
            console.log(`[altegio/test/clients/${clientId}] ✅ Got full client data from ${url} with keys:`, Object.keys(fullClientData || {}));
            apiError = null; // Скидаємо помилку, якщо успішно
            break;
          } else {
            console.log(`[altegio/test/clients/${clientId}] ⚠️ Response received but no client data (id missing)`);
          }
        }
      } catch (err: any) {
        const errorInfo = {
          url,
          error: err.message || String(err),
          status: err.status,
          statusText: err.statusText,
        };
        apiErrorsList.push(errorInfo);
        apiError = errorInfo; // Зберігаємо останню помилку
        console.warn(`[altegio/test/clients/${clientId}] ❌ Attempt ${i + 1}/${apiAttempts.length} failed: ${url} - ${err.message} (status: ${err.status || 'unknown'})`);
        // Продовжуємо спроби з іншими URL
      }
    }
    
    console.log(`[altegio/test/clients/${clientId}] Calling getClient()...`);
    const client = await getClient(companyId, clientId);
    console.log(`[altegio/test/clients/${clientId}] getClient() returned:`, client ? `client with id ${client.id}` : 'null');
    
    // Працюємо тільки з API, без fallback на вебхуки
    if (!client && !fullClientData) {
      return NextResponse.json({
        ok: false,
        error: `Client with ID ${clientId} not found via API`,
        clientId,
        companyId,
        apiErrors: apiErrorsList.length > 0 ? apiErrorsList : (apiError ? [apiError] : []),
        note: 'Перевірте логи для детальної інформації про помилки API. Всі спроби endpoint\'ів показані в apiErrors.',
      }, { status: 404 });
    }
    
    // Використовуємо дані з API
    const clientData = client || fullClientData;
    
    if (!clientData) {
      return NextResponse.json({
        ok: false,
        error: `Client data is null`,
        clientId,
        companyId,
      }, { status: 500 });
    }
    let webhookClientData: any = null;
    const webhookDiagnostics: any = {
      webhookLogChecked: 0,
      recordsLogChecked: 0,
      foundClientIds: new Set<number>(),
      sampleWebhookStructures: [] as any[],
    };
    
    if (!client && !fullClientData) {
      console.log(`[altegio/test/clients/${clientId}] Client not found via API, checking webhooks...`);
      try {
        const { kvRead } = await import('@/lib/kv');
        const webhooksLogRaw = await kvRead.lrange('altegio:webhook:log', 0, 999);
        const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
        
        console.log(`[altegio/test/clients/${clientId}] Checking ${webhooksLogRaw.length} webhook:log entries...`);
        // Спочатку перевіряємо webhook:log (повні вебхуки)
        for (let i = 0; i < webhooksLogRaw.length && i < 100; i++) {
          const raw = webhooksLogRaw[i];
          webhookDiagnostics.webhookLogChecked++;
          try {
            let parsed: any;
            if (typeof raw === 'string') {
              parsed = JSON.parse(raw);
            } else {
              parsed = raw;
            }
            
            if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
              try {
                parsed = JSON.parse(parsed.value);
              } catch {
                continue;
              }
            }
            
            // Збираємо діагностичну інформацію про знайдені clientId
            const webhookClientId = parsed?.body?.data?.client?.id || 
                                   parsed?.body?.data?.client_id || 
                                   (parsed?.body?.resource === 'client' ? parsed?.body?.resource_id : null);
            
            if (webhookClientId && typeof webhookClientId === 'number') {
              webhookDiagnostics.foundClientIds.add(webhookClientId);
            }
            
            // Зберігаємо приклади структур для діагностики
            if (webhookDiagnostics.sampleWebhookStructures.length < 3 && parsed?.body) {
              webhookDiagnostics.sampleWebhookStructures.push({
                resource: parsed.body.resource,
                resourceId: parsed.body.resource_id,
                hasClient: !!parsed.body.data?.client,
                clientId: webhookClientId,
                structure: {
                  bodyKeys: Object.keys(parsed.body || {}),
                  dataKeys: Object.keys(parsed.body?.data || {}),
                  clientKeys: Object.keys(parsed.body?.data?.client || {}),
                },
              });
            }
            
            // Перевіряємо, чи це вебхук про цього клієнта
            if (webhookClientId === clientId) {
              // Для client events: body.data або body.data.client
              // Для record events: body.data.client
              const clientData = parsed?.body?.data?.client || 
                               (parsed?.body?.resource === 'client' ? parsed?.body?.data : null);
              
              if (clientData && (clientData.id === clientId || webhookClientId === clientId)) {
                webhookClientData = clientData;
                console.log(`[altegio/test/clients/${clientId}] ✅ Found client data in webhook:log with keys:`, Object.keys(webhookClientData || {}));
                break;
              }
            }
          } catch (err) {
            console.warn(`[altegio/test/clients/${clientId}] Error parsing webhook:log entry:`, err);
            continue;
          }
        }
        
        // Якщо не знайдено в webhook:log, перевіряємо records:log
        if (!webhookClientData) {
          console.log(`[altegio/test/clients/${clientId}] Not found in webhook:log, checking ${recordsLogRaw.length} records:log entries...`);
          for (let i = 0; i < recordsLogRaw.length && i < 1000; i++) {
            const raw = recordsLogRaw[i];
            webhookDiagnostics.recordsLogChecked++;
            try {
              let parsed: any;
              if (typeof raw === 'string') {
                parsed = JSON.parse(raw);
              } else {
                parsed = raw;
              }
              
              if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
                try {
                  parsed = JSON.parse(parsed.value);
                } catch {
                  continue;
                }
              }
              
              // В records:log структура: data.client.id або clientId
              const recordClientId = parsed?.data?.client?.id || 
                                    parsed?.clientId;
              
              if (recordClientId && typeof recordClientId === 'number') {
                webhookDiagnostics.foundClientIds.add(recordClientId);
              }
              
              if (recordClientId === clientId && parsed?.data?.client) {
                webhookClientData = parsed.data.client;
                console.log(`[altegio/test/clients/${clientId}] ✅ Found client data in records:log with keys:`, Object.keys(webhookClientData || {}));
                break;
              }
            } catch (err) {
              console.warn(`[altegio/test/clients/${clientId}] Error parsing records:log entry:`, err);
              continue;
            }
          }
        }
        
        // Конвертуємо Set в масив для JSON
        webhookDiagnostics.foundClientIds = Array.from(webhookDiagnostics.foundClientIds).slice(0, 50);
      } catch (err) {
        console.warn(`[altegio/test/clients/${clientId}] Failed to check webhooks:`, err);
        webhookDiagnostics.error = err instanceof Error ? err.message : String(err);
      }
    }
    
    if (!client && !webhookClientData && !fullClientData) {
      return NextResponse.json({
        ok: false,
        error: `Client with ID ${clientId} not found in API or webhooks`,
        clientId,
        companyId,
        apiError: apiError || null,
        webhookDiagnostics: {
          ...webhookDiagnostics,
          searchedInWebhookLog: webhookDiagnostics.webhookLogChecked > 0,
          searchedInRecordsLog: webhookDiagnostics.recordsLogChecked > 0,
          totalUniqueClientIdsFound: webhookDiagnostics.foundClientIds.length,
          closestClientIds: webhookDiagnostics.foundClientIds
            .map((id: number) => ({ id, diff: Math.abs(id - clientId) }))
            .sort((a, b) => a.diff - b.diff)
            .slice(0, 10),
        },
        note: 'Перевірте логи для детальної інформації про помилки API. webhookDiagnostics показує, скільки вебхуків перевірено та які clientId знайдені.',
      }, { status: 404 });
    }
    
    // Використовуємо дані з API або вебхуків
    const clientData = client || webhookClientData;
    
    // Повна структура клієнта
    const allKeys = Object.keys(clientData);
    const standardFields = ['id', 'name', 'phone', 'email', 'created_at', 'updated_at', 'company_id'];
    const customFields = allKeys.filter(key => !standardFields.includes(key));
    
    // Шукаємо поля, пов'язані з візитами та сумами
    const visitRelatedFields: Record<string, any> = {};
    const amountRelatedFields: Record<string, any> = {};
    const allClientData = fullClientData || clientData;
    
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
      source: 'api',
      // Дані з API (якщо отримали)
      apiData: fullClientData ? {
        keys: Object.keys(fullClientData),
        hasSpent: 'spent' in fullClientData,
        spent: fullClientData.spent,
        hasVisits: 'visits' in fullClientData,
        visits: fullClientData.visits,
        hasBalance: 'balance' in fullClientData,
        balance: fullClientData.balance,
        hasSuccessVisitsCount: 'success_visits_count' in fullClientData,
        successVisitsCount: fullClientData.success_visits_count,
        hasTotalSpent: 'total_spent' in fullClientData,
        totalSpent: fullClientData.total_spent,
        fullData: fullClientData,
      } : (client ? {
        keys: Object.keys(client),
        hasSpent: 'spent' in client,
        spent: (client as any).spent,
        hasVisits: 'visits' in client,
        visits: (client as any).visits,
        hasBalance: 'balance' in client,
        balance: (client as any).balance,
        hasSuccessVisitsCount: 'success_visits_count' in client,
        successVisitsCount: (client as any).success_visits_count,
        hasTotalSpent: 'total_spent' in client,
        totalSpent: (client as any).total_spent,
        fullData: client,
      } : null),
      // Дані клієнта (з API або вебхука)
      client: {
        ...clientData,
        // Додаємо мета-інформацію
        _meta: {
          allKeys,
          customFields,
          hasCustomFields: !!clientData.custom_fields,
          customFieldsKeys: clientData.custom_fields ? Object.keys(clientData.custom_fields) : [],
        },
      },
      // Повна raw структура для діагностики
      rawStructure: JSON.stringify(clientData, null, 2),
      // Повна структура з усіма полями (якщо отримали)
      fullClientData: fullClientData ? JSON.stringify(fullClientData, null, 2) : null,
      // Поля, пов'язані з візитами
      visitRelatedFields,
      // Поля, пов'язані з сумами
      amountRelatedFields: {
        ...amountRelatedFields,
        // Додаємо поля з API, якщо вони є
        spent: clientData.spent,
        balance: (clientData as any).balance,
      },
      // Детальна інформація про custom_fields
      customFieldsData: clientData.custom_fields || null,
      // Помилки API (якщо були)
      apiErrors: apiErrorsList.length > 0 ? apiErrorsList : (apiError ? [apiError] : []),
      note: 'Використовуй fullClientData або rawStructure для повного перегляду всіх полів. visitRelatedFields та amountRelatedFields показують релевантні поля. source вказує, звідки отримані дані (api або webhook). apiData показує, чи отримали ми success_visits_count та total_spent через API.',
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

