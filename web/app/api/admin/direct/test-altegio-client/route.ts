// web/app/api/admin/direct/test-altegio-client/route.ts
// Тестовий endpoint для діагностики отримання custom_fields з Altegio для конкретного клієнта

import { NextRequest, NextResponse } from 'next/server';
import { altegioFetch } from '@/lib/altegio/client';
import { getEnvValue } from '@/lib/env';
import { normalizeInstagram } from '@/lib/normalize';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/**
 * POST - тестування отримання custom_fields для конкретного клієнта
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { client_id, location_id } = body;

    if (!client_id) {
      return NextResponse.json(
        { ok: false, error: 'client_id is required' },
        { status: 400 }
      );
    }

    const companyIdStr = location_id || getEnvValue('ALTEGIO_COMPANY_ID');
    if (!companyIdStr) {
      return NextResponse.json(
        { ok: false, error: 'Altegio location_id (company_id) not provided' },
        { status: 400 }
      );
    }

    const companyId = parseInt(companyIdStr, 10);
    const clientId = parseInt(String(client_id), 10);

    if (isNaN(companyId) || isNaN(clientId)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid location_id or client_id (must be numbers)' },
        { status: 400 }
      );
    }

    console.log(`[direct/test-altegio-client] Testing client ${clientId} from location ${companyId}`);

    const results: any = {
      client_id: clientId,
      location_id: companyId,
      attempts: [],
    };

    // Спроба 1: GET /company/{id}/clients/{id} (множина)
    try {
      const response1 = await altegioFetch<any>(`/company/${companyId}/clients/${clientId}`, {
        method: 'GET',
      });
      results.attempts.push({
        method: 'GET',
        url: `/company/${companyId}/client/${clientId}`,
        params: 'none',
        success: true,
        hasCustomFields: !!response1?.custom_fields,
        customFieldsType: typeof response1?.custom_fields,
        customFieldsIsArray: Array.isArray(response1?.custom_fields),
        customFieldsKeys: response1?.custom_fields && typeof response1?.custom_fields === 'object' && !Array.isArray(response1?.custom_fields)
          ? Object.keys(response1?.custom_fields)
          : [],
        response: response1,
      });
    } catch (err) {
      results.attempts.push({
        method: 'GET',
        url: `/company/${companyId}/clients/${clientId}`,
        params: 'none',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Спроба 2: GET /company/{id}/clients/{id} з fields[]=custom_fields
    try {
      const response2 = await altegioFetch<any>(
        `/company/${companyId}/clients/${clientId}?fields[]=id&fields[]=name&fields[]=phone&fields[]=email&fields[]=custom_fields`,
        {
          method: 'GET',
        }
      );
      results.attempts.push({
        method: 'GET',
        url: `/company/${companyId}/clients/${clientId}`,
        params: 'fields[]=custom_fields',
        success: true,
        hasCustomFields: !!response2?.custom_fields,
        customFieldsType: typeof response2?.custom_fields,
        customFieldsIsArray: Array.isArray(response2?.custom_fields),
        customFieldsKeys: response2?.custom_fields && typeof response2?.custom_fields === 'object' && !Array.isArray(response2?.custom_fields)
          ? Object.keys(response2?.custom_fields)
          : [],
        response: response2,
      });
    } catch (err) {
      results.attempts.push({
        method: 'GET',
        url: `/company/${companyId}/clients/${clientId}`,
        params: 'fields[]=custom_fields',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Спроба 3: GET /company/{id}/clients/{id} з include[]=custom_fields
    try {
      const response3 = await altegioFetch<any>(
        `/company/${companyId}/clients/${clientId}?include[]=custom_fields&with[]=custom_fields`,
        {
          method: 'GET',
        }
      );
      results.attempts.push({
        method: 'GET',
        url: `/company/${companyId}/clients/${clientId}`,
        params: 'include[]=custom_fields',
        success: true,
        hasCustomFields: !!response3?.custom_fields,
        customFieldsType: typeof response3?.custom_fields,
        customFieldsIsArray: Array.isArray(response3?.custom_fields),
        customFieldsKeys: response3?.custom_fields && typeof response3?.custom_fields === 'object' && !Array.isArray(response3?.custom_fields)
          ? Object.keys(response3?.custom_fields)
          : [],
        response: response3,
      });
    } catch (err) {
      results.attempts.push({
        method: 'GET',
        url: `/company/${companyId}/clients/${clientId}`,
        params: 'include[]=custom_fields',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Спроба 4: POST /clients/search з фільтром по client_id (різні операції та формати)
    const filterVariants = [
      { field: 'id', operation: 'eq', value: clientId },
      { field: 'id', operation: '=', value: clientId },
      { field: 'id', operation: '==', value: clientId },
      { field: 'id', operation: 'equals', value: clientId },
      { field: 'client_id', operation: 'eq', value: clientId },
      { id: clientId }, // Можливо, фільтр має інший формат
    ];
    
    for (const filterVariant of filterVariants) {
      try {
        const response4 = await altegioFetch<any>(`/company/${companyId}/clients/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filters: Array.isArray(filterVariant) ? filterVariant : [filterVariant],
            fields: ['id', 'name', 'phone', 'email', 'custom_fields'],
            page: 1,
            page_size: 1,
          }),
        });
        
        let clientFromSearch: any = null;
        if (Array.isArray(response4)) {
          clientFromSearch = response4[0];
        } else if (response4?.data && Array.isArray(response4.data)) {
          clientFromSearch = response4.data[0];
        } else if (response4?.clients && Array.isArray(response4.clients)) {
          clientFromSearch = response4.clients[0];
        } else if (response4 && typeof response4 === 'object' && !Array.isArray(response4)) {
          clientFromSearch = response4;
        }

        if (clientFromSearch && clientFromSearch.id === clientId) {
          results.attempts.push({
            method: 'POST',
            url: `/company/${companyId}/clients/search`,
            params: `filters: ${JSON.stringify(filterVariant)} + fields[]=custom_fields`,
            success: true,
            hasCustomFields: !!clientFromSearch?.custom_fields,
            customFieldsType: typeof clientFromSearch?.custom_fields,
            customFieldsIsArray: Array.isArray(clientFromSearch?.custom_fields),
            customFieldsKeys: clientFromSearch?.custom_fields && typeof clientFromSearch?.custom_fields === 'object' && !Array.isArray(clientFromSearch?.custom_fields)
              ? Object.keys(clientFromSearch?.custom_fields)
              : [],
            response: clientFromSearch,
            allKeys: Object.keys(clientFromSearch || {}),
          });
          break; // Якщо знайшли клієнта, не пробуємо інші варіанти
        }
      } catch (err) {
        // Продовжуємо спроби
      }
    }

    // Спроба 5: POST /clients/search без фільтрів, але з пагінацією (шукаємо клієнта на різних сторінках)
    // Також перевіряємо структуру відповіді - можливо, custom_fields повертаються в іншому форматі
    try {
      let foundClient: any = null;
      let page = 1;
      const maxPages = 10; // Перевіряємо до 10 сторінок
      
      while (page <= maxPages && !foundClient) {
        const response5 = await altegioFetch<any>(`/company/${companyId}/clients/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields: ['id', 'name', 'phone', 'email', 'custom_fields'],
            page,
            page_size: 100,
            order_by: 'id',
            order_by_direction: 'desc',
          }),
        });
        
        let clients: any[] = [];
        if (Array.isArray(response5)) {
          clients = response5;
        } else if (response5?.data && Array.isArray(response5.data)) {
          clients = response5.data;
        } else if (response5?.clients && Array.isArray(response5.clients)) {
          clients = response5.clients;
        }
        
        foundClient = clients.find((c: any) => c.id === clientId);
        
        if (foundClient) {
          // Детально логуємо структуру знайденого клієнта
          results.attempts.push({
            method: 'POST',
            url: `/company/${companyId}/clients/search`,
            params: `no filters, page ${page}, page_size 100`,
            success: true,
            hasCustomFields: !!foundClient?.custom_fields,
            customFieldsType: typeof foundClient?.custom_fields,
            customFieldsIsArray: Array.isArray(foundClient?.custom_fields),
            customFieldsKeys: foundClient?.custom_fields && typeof foundClient?.custom_fields === 'object' && !Array.isArray(foundClient?.custom_fields)
              ? Object.keys(foundClient?.custom_fields)
              : [],
            response: foundClient,
            allKeys: Object.keys(foundClient || {}),
            fullResponse: JSON.stringify(foundClient, null, 2).substring(0, 1000), // Перші 1000 символів для діагностики
            totalClientsInResponse: clients.length,
            foundOnPage: page,
          });
          
          // Спроба 5b: Отримати клієнта з include замість fields
          try {
            const response5b = await altegioFetch<any>(`/company/${companyId}/clients/search`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                filters: [{ field: 'id', operation: 'eq', value: clientId }],
                include: ['custom_fields'],
                page: 1,
                page_size: 1,
              }),
            });
            
            let clientWithInclude: any = null;
            if (Array.isArray(response5b)) {
              clientWithInclude = response5b[0];
            } else if (response5b?.data && Array.isArray(response5b.data)) {
              clientWithInclude = response5b.data[0];
            } else if (response5b?.clients && Array.isArray(response5b.clients)) {
              clientWithInclude = response5b.clients[0];
            } else if (response5b && typeof response5b === 'object' && !Array.isArray(response5b)) {
              clientWithInclude = response5b;
            }
            
            if (clientWithInclude && clientWithInclude.id === clientId) {
              results.attempts.push({
                method: 'POST',
                url: `/company/${companyId}/clients/search`,
                params: `filters + include: ['custom_fields']`,
                success: true,
                hasCustomFields: !!clientWithInclude?.custom_fields,
                customFieldsType: typeof clientWithInclude?.custom_fields,
                customFieldsIsArray: Array.isArray(clientWithInclude?.custom_fields),
                customFieldsKeys: clientWithInclude?.custom_fields && typeof clientWithInclude?.custom_fields === 'object' && !Array.isArray(clientWithInclude?.custom_fields)
                  ? Object.keys(clientWithInclude?.custom_fields)
                  : [],
                response: clientWithInclude,
                allKeys: Object.keys(clientWithInclude || {}),
                fullResponse: JSON.stringify(clientWithInclude, null, 2).substring(0, 1000),
              });
            }
          } catch (err) {
            // Ігноруємо помилки
          }
          
          // Спроба 5c: Отримати клієнта БЕЗ fields (можливо, поверне всі поля включаючи custom_fields)
          try {
            const response5c = await altegioFetch<any>(`/company/${companyId}/clients/search`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                filters: [{ field: 'id', operation: 'eq', value: clientId }],
                page: 1,
                page_size: 1,
              }),
            });
            
            let clientWithoutFields: any = null;
            if (Array.isArray(response5c)) {
              clientWithoutFields = response5c[0];
            } else if (response5c?.data && Array.isArray(response5c.data)) {
              clientWithoutFields = response5c.data[0];
            } else if (response5c?.clients && Array.isArray(response5c.clients)) {
              clientWithoutFields = response5c.clients[0];
            } else if (response5c && typeof response5c === 'object' && !Array.isArray(response5c)) {
              clientWithoutFields = response5c;
            }
            
            if (clientWithoutFields && clientWithoutFields.id === clientId) {
              results.attempts.push({
                method: 'POST',
                url: `/company/${companyId}/clients/search`,
                params: `filters, NO fields parameter (should return all fields)`,
                success: true,
                hasCustomFields: !!clientWithoutFields?.custom_fields,
                customFieldsType: typeof clientWithoutFields?.custom_fields,
                customFieldsIsArray: Array.isArray(clientWithoutFields?.custom_fields),
                customFieldsKeys: clientWithoutFields?.custom_fields && typeof clientWithoutFields?.custom_fields === 'object' && !Array.isArray(clientWithoutFields?.custom_fields)
                  ? Object.keys(clientWithoutFields?.custom_fields)
                  : [],
                response: clientWithoutFields,
                allKeys: Object.keys(clientWithoutFields || {}),
                fullResponse: JSON.stringify(clientWithoutFields, null, 2).substring(0, 1000),
              });
            }
          } catch (err) {
            // Ігноруємо помилки
          }
          
          break;
        }
        
        if (clients.length === 0) {
          // Більше немає клієнтів
          break;
        }
        
        page++;
      }
      
      if (!foundClient) {
        results.attempts.push({
          method: 'POST',
          url: `/company/${companyId}/clients/search`,
          params: `no filters, pages 1-${page - 1}`,
          success: false,
          error: `Client ${clientId} not found in first ${page - 1} pages`,
        });
      }
    } catch (err) {
      results.attempts.push({
        method: 'POST',
        url: `/company/${companyId}/clients/search`,
        params: 'no filters, pagination',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Спроба 6: Отримати значення custom_fields для конкретного клієнта
    // Можливо, є endpoint типу /custom_fields/client/{client_id} або /company/{id}/client/{id}/custom_fields
    const customFieldEndpoints = [
      `/company/${companyId}/client/${clientId}/custom_fields`,
      `/company/${companyId}/clients/${clientId}/custom_fields`,
      `/custom_fields/client/${clientId}`,
      `/custom_fields/clients/${clientId}`,
      `/company/${companyId}/custom_fields/client/${clientId}`,
      `/custom_fields/client/${companyId}/values/${clientId}`,
      `/custom_fields/client/${companyId}/${clientId}`,
    ];
    
    for (const endpoint of customFieldEndpoints) {
      try {
        const customFieldsValues = await altegioFetch<any>(endpoint, {
          method: 'GET',
        });
        results.attempts.push({
          method: 'GET',
          url: endpoint,
          params: 'custom_fields values',
          success: true,
          response: customFieldsValues,
          note: 'Attempting to get custom field values for specific client',
        });
        break; // Якщо знайшли працюючий endpoint, не пробуємо інші
      } catch (err) {
        // Продовжуємо спроби
      }
    }
    
    // Спроба 6b: Можливо, потрібно отримати значення через POST з client_id
    try {
      const customFieldsValuesPost = await altegioFetch<any>(`/custom_fields/client/${companyId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
        }),
      });
      results.attempts.push({
        method: 'POST',
        url: `/custom_fields/client/${companyId}`,
        params: `body: { client_id: ${clientId} }`,
        success: true,
        response: customFieldsValuesPost,
        note: 'Attempting to get custom field values via POST with client_id',
      });
    } catch (err) {
      // Ігноруємо помилки
    }

    // Спроба 7: Отримати список custom_fields метаданих для location (для перевірки структури)
    try {
      const customFieldsMeta = await altegioFetch<any>(`/custom_fields/client/${companyId}`, {
        method: 'GET',
      });
      results.attempts.push({
        method: 'GET',
        url: `/custom_fields/client/${companyId}`,
        params: 'metadata',
        success: true,
        response: customFieldsMeta,
        note: 'This returns metadata about custom fields, not values. Field code: instagram-user-name',
        instagramFieldCode: 'instagram-user-name', // З скріншота
      });
    } catch (err) {
      // Ігноруємо помилки
    }

    // Витягуємо Instagram з усіх спроб
    // Згідно зі скріншотом, ключ для API: "instagram-user-name"
    const instagramValues: string[] = [];
    for (const attempt of results.attempts) {
      if (attempt.success && attempt.response) {
        const response = attempt.response;
        
        // Якщо це об'єкт клієнта
        if (response && typeof response === 'object') {
          // Перевіряємо custom_fields як об'єкт
          if (response.custom_fields && typeof response.custom_fields === 'object' && !Array.isArray(response.custom_fields)) {
            const checks = [
              response.custom_fields['instagram-user-name'], // Основний ключ зі скріншота
              response.custom_fields['Instagram user name'],
              response.custom_fields.instagram_user_name,
              response.custom_fields.instagram,
            ];
            
            for (const value of checks) {
              if (value && typeof value === 'string' && value.trim()) {
                const normalized = normalizeInstagram(value.trim());
                if (normalized && !instagramValues.includes(normalized)) {
                  instagramValues.push(normalized);
                }
              }
            }
          }
          
          // Перевіряємо прямі поля (якщо custom_fields - це масив або інша структура)
          const directChecks = [
            response['instagram-user-name'],
            response.instagram_user_name,
            response.instagram,
          ];
          
          for (const value of directChecks) {
            if (value && typeof value === 'string' && value.trim()) {
              const normalized = normalizeInstagram(value.trim());
              if (normalized && !instagramValues.includes(normalized)) {
                instagramValues.push(normalized);
              }
            }
          }
          
          // Якщо response - це масив custom_fields (якщо отримали через окремий endpoint)
          if (Array.isArray(response)) {
            for (const field of response) {
              if (field && typeof field === 'object') {
                // Перевіряємо різні структури поля
                const fieldCode = field.code || field.key || field.field_code;
                const fieldValue = field.value || field.data || field.content;
                
                if (fieldCode === 'instagram-user-name' && fieldValue && typeof fieldValue === 'string') {
                  const normalized = normalizeInstagram(fieldValue.trim());
                  if (normalized && !instagramValues.includes(normalized)) {
                    instagramValues.push(normalized);
                  }
                }
              }
            }
          }
        }
      }
    }

    results.instagramFound = instagramValues.length > 0;
    results.instagramValues = instagramValues;

    return NextResponse.json({
      ok: true,
      ...results,
    });
  } catch (error) {
    console.error('[direct/test-altegio-client] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
