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

    // Спроба 1: GET /company/{id}/client/{id} без параметрів
    try {
      const response1 = await altegioFetch<any>(`/company/${companyId}/client/${clientId}`, {
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
        url: `/company/${companyId}/client/${clientId}`,
        params: 'none',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Спроба 2: GET з fields[]=custom_fields
    try {
      const response2 = await altegioFetch<any>(
        `/company/${companyId}/client/${clientId}?fields[]=id&fields[]=name&fields[]=phone&fields[]=email&fields[]=custom_fields`,
        {
          method: 'GET',
        }
      );
      results.attempts.push({
        method: 'GET',
        url: `/company/${companyId}/client/${clientId}`,
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
        url: `/company/${companyId}/client/${clientId}`,
        params: 'fields[]=custom_fields',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Спроба 3: GET з include[]=custom_fields
    try {
      const response3 = await altegioFetch<any>(
        `/company/${companyId}/client/${clientId}?include[]=custom_fields&with[]=custom_fields`,
        {
          method: 'GET',
        }
      );
      results.attempts.push({
        method: 'GET',
        url: `/company/${companyId}/client/${clientId}`,
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
        url: `/company/${companyId}/client/${clientId}`,
        params: 'include[]=custom_fields',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Спроба 4: POST /clients/search з фільтром по client_id
    try {
      const response4 = await altegioFetch<any>(`/company/${companyId}/clients/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: [{ field: 'id', operation: 'equals', value: clientId }],
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

      results.attempts.push({
        method: 'POST',
        url: `/company/${companyId}/clients/search`,
        params: 'filters + fields[]=custom_fields',
        success: true,
        hasCustomFields: !!clientFromSearch?.custom_fields,
        customFieldsType: typeof clientFromSearch?.custom_fields,
        customFieldsIsArray: Array.isArray(clientFromSearch?.custom_fields),
        customFieldsKeys: clientFromSearch?.custom_fields && typeof clientFromSearch?.custom_fields === 'object' && !Array.isArray(clientFromSearch?.custom_fields)
          ? Object.keys(clientFromSearch?.custom_fields)
          : [],
        response: clientFromSearch || response4,
      });
    } catch (err) {
      results.attempts.push({
        method: 'POST',
        url: `/company/${companyId}/clients/search`,
        params: 'filters + fields[]=custom_fields',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Спроба 5: Отримати список custom_fields для location
    try {
      // Спробуємо різні field_category
      const fieldCategories = ['client', 'clients', 'client_fields'];
      for (const category of fieldCategories) {
        try {
          const customFieldsMeta = await altegioFetch<any>(`/custom_fields/${category}/${companyId}`, {
            method: 'GET',
          });
          results.attempts.push({
            method: 'GET',
            url: `/custom_fields/${category}/${companyId}`,
            params: 'metadata',
            success: true,
            response: customFieldsMeta,
            note: 'This returns metadata about custom fields, not values',
          });
        } catch (err) {
          // Ігноруємо помилки для неіснуючих категорій
        }
      }
    } catch (err) {
      // Ігноруємо помилки
    }

    // Витягуємо Instagram з усіх спроб
    const instagramValues: string[] = [];
    for (const attempt of results.attempts) {
      if (attempt.success && attempt.response) {
        const client = attempt.response;
        
        // Перевіряємо різні місця
        const checks = [
          client?.custom_fields?.['instagram-user-name'],
          client?.custom_fields?.['Instagram user name'],
          client?.custom_fields?.instagram_user_name,
          client?.custom_fields?.instagram,
          client?.['instagram-user-name'],
          client?.instagram_user_name,
          client?.instagram,
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
