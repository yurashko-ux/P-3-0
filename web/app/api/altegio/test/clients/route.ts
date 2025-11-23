// web/app/api/altegio/test/clients/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getClients, getClient } from '@/lib/altegio/clients';
import { assertAltegioEnv } from '@/lib/altegio/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Тестовий endpoint для перевірки отримання клієнтів та кастомних полів
 */
export async function GET(req: NextRequest) {
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
    if (isNaN(companyId)) {
      return NextResponse.json(
        { 
          ok: false, 
          error: `Invalid ALTEGIO_COMPANY_ID: ${companyIdStr}` 
        },
        { status: 400 }
      );
    }
    
    // Отримуємо список клієнтів (обмежуємо до 10 для тесту)
    const clients = await getClients(companyId, 10);
    
    if (clients.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No clients found',
        clientsCount: 0,
        clients: [],
        firstClientStructure: null,
        instagramFieldFound: false,
        instagramFieldName: null,
      });
    }
    
    // Аналізуємо першого клієнта для перевірки кастомних полів
    const firstClient = clients[0];
    const allKeys = Object.keys(firstClient);
    
    // Шукаємо поле Instagram username в різних варіантах
    const instagramFieldVariants = [
      'instagram-user-name',
      'instagram_user_name',
      'instagramUsername',
      'instagram_username',
      'instagram',
    ];
    
    let instagramFieldFound = false;
    let instagramFieldName: string | null = null;
    let instagramFieldValue: string | null = null;
    
    // Перевіряємо всі можливі варіанти назв
    for (const variant of instagramFieldVariants) {
      const foundKey = allKeys.find(key => 
        key.toLowerCase().replace(/[-_]/g, '') === variant.toLowerCase().replace(/[-_]/g, '')
      );
      
      if (foundKey && firstClient[foundKey]) {
        instagramFieldFound = true;
        instagramFieldName = foundKey;
        instagramFieldValue = String(firstClient[foundKey]);
        break;
      }
    }
    
    // Перевіряємо custom_fields, якщо вони є
    if (!instagramFieldFound && firstClient.custom_fields) {
      for (const variant of instagramFieldVariants) {
        const foundKey = Object.keys(firstClient.custom_fields).find(key => 
          key.toLowerCase().replace(/[-_]/g, '') === variant.toLowerCase().replace(/[-_]/g, '')
        );
        
        if (foundKey && firstClient.custom_fields[foundKey]) {
          instagramFieldFound = true;
          instagramFieldName = `custom_fields.${foundKey}`;
          instagramFieldValue = String(firstClient.custom_fields[foundKey]);
          break;
        }
      }
    }
    
    // Знаходимо всі кастомні поля (поля, які не є стандартними)
    const standardFields = ['id', 'name', 'phone', 'email', 'created_at', 'updated_at', 'company_id'];
    const customFields = allKeys.filter(key => !standardFields.includes(key));
    
    // Детальна структура першого клієнта
    const firstClientStructure = {
      id: firstClient.id,
      name: firstClient.name,
      phone: firstClient.phone,
      email: firstClient.email,
      allKeys: allKeys,
      customFields: customFields,
      customFieldsData: customFields.reduce((acc: Record<string, any>, key: string) => {
        acc[key] = firstClient[key];
        return acc;
      }, {}),
      custom_fields: firstClient.custom_fields || null,
      instagramField: instagramFieldFound ? {
        name: instagramFieldName,
        value: instagramFieldValue,
      } : null,
    };
    
    return NextResponse.json({
      ok: true,
      message: `Found ${clients.length} clients`,
      clientsCount: clients.length,
      clients: clients.map(client => ({
        id: client.id,
        name: client.name,
        phone: client.phone,
        email: client.email,
      })),
      firstClientStructure,
      instagramFieldFound,
      instagramFieldName,
      instagramFieldValue,
      allKeys: allKeys,
      customFields: customFields,
      note: instagramFieldFound 
        ? `✅ Instagram field found: ${instagramFieldName} = ${instagramFieldValue}`
        : '⚠️ Instagram field not found. Check field name variants or custom_fields object.',
    });
  } catch (err) {
    console.error('[altegio/test/clients] Error:', err);
    
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}

