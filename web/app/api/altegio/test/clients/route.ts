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
    
    // Спочатку перевіримо, чи працює отримання компанії (щоб переконатися, що company_id правильний)
    let companyExists = false;
    try {
      const { getCompany } = await import('@/lib/altegio/companies');
      const company = await getCompany(companyId);
      companyExists = !!company;
      console.log(`[altegio/test/clients] Company ${companyId} exists: ${companyExists}`, company ? { id: company.id, title: company.title || company.public_title } : '');
    } catch (companyErr) {
      console.warn(`[altegio/test/clients] Failed to verify company ${companyId}:`, companyErr);
    }
    
    if (!companyExists) {
      return NextResponse.json({
        ok: false,
        error: `Company with ID ${companyId} not found. Please check ALTEGIO_COMPANY_ID environment variable.`,
        companyId,
      }, { status: 400 });
    }
    
    // Отримуємо список клієнтів (обмежуємо до 10 для тесту)
    let clients: any[] = [];
    let source = 'direct';
    let errorMessage = '';
    let rawResponse: any = null;
    
    try {
      // Спочатку отримуємо список (може бути тільки ID)
      clients = await getClients(companyId, 10);
      source = 'direct';
      
      // Перевіряємо, чи клієнти мають дані
      const clientsWithData = clients.filter((c: any) => {
        // Перевіряємо, чи є хоча б ім'я, телефон або email
        return c.name || c.phone || c.email || Object.keys(c).length > 1;
      });
      
      if (clientsWithData.length < clients.length) {
        console.log(`[altegio/test/clients] ⚠️ Filtered ${clients.length - clientsWithData.length} clients without data (only ID or empty)`);
      }
      
      // Завжди отримуємо повні дані через окремі запити getClient() для отримання custom_fields
      // (API може повертати тільки базові поля, а custom_fields потрібні окремі запити)
      if (clients.length > 0) {
        console.log('[altegio/test/clients] ⚠️ Fetching full client details to get custom_fields (Card number, Note, Instagram)...');
        const clientsWithFullDetails: any[] = [];
        let skippedCount = 0;
        
        for (const client of clients.slice(0, 10)) {
          try {
            // Отримуємо повні дані клієнта через getClient() - там мають бути custom_fields
            const fullClient = await getClient(companyId, client.id);
            if (fullClient) {
              clientsWithFullDetails.push(fullClient);
              console.log(`[altegio/test/clients] ✅ Got full info for client ${client.id}:`, {
                name: fullClient.name,
                hasCustomFields: !!fullClient.custom_fields,
                customFieldsKeys: fullClient.custom_fields ? Object.keys(fullClient.custom_fields) : [],
              });
            } else {
              // Якщо не отримали повні дані, використовуємо те, що є
              clientsWithFullDetails.push(client);
            }
            // Невелика затримка, щоб не перевантажити API
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (err) {
            skippedCount++;
            console.warn(`[altegio/test/clients] Failed to get full info for client ${client.id}:`, err);
            // Якщо не вдалося, використовуємо базові дані
            clientsWithFullDetails.push(client);
          }
        }
        
        console.log(`[altegio/test/clients] Summary: ${clientsWithFullDetails.length} clients with full details, ${skippedCount} skipped`);
        clients = clientsWithFullDetails;
      }
      
      // Перевіряємо, чи потрібно робити окремі запити для даних
      const needsFullFetch = clients.length > 0 && (
        clients.every((c: any) => Object.keys(c).length === 1 && 'id' in c) ||
        clientsWithData.length === 0
      );
      
      if (needsFullFetch && clients.length > 0 && clients.every((c: any) => !c.custom_fields)) {
        console.log('[altegio/test/clients] ⚠️ Received only IDs or clients without data, fetching full details...');
        const clientsWithDetails: any[] = [];
        let skippedCount = 0;
        
        for (const client of clients.slice(0, 10)) {
          try {
            const fullClient = await getClient(companyId, client.id);
            if (fullClient) {
              // Перевіряємо, чи клієнт має дані
              const hasData = fullClient.name || fullClient.phone || fullClient.email;
              if (hasData) {
                clientsWithDetails.push(fullClient);
                console.log(`[altegio/test/clients] ✅ Got client ${client.id}: name="${fullClient.name || 'none'}", phone="${fullClient.phone || 'none'}"`);
              } else {
                skippedCount++;
                console.log(`[altegio/test/clients] ⚠️ Client ${client.id} has no data - skipping`);
              }
            } else {
              skippedCount++;
              console.log(`[altegio/test/clients] ⚠️ Client ${client.id} not found - skipping`);
            }
            // Невелика затримка, щоб не перевантажити API
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (err) {
            skippedCount++;
            console.warn(`[altegio/test/clients] Failed to get client ${client.id}:`, err);
          }
        }
        
        console.log(`[altegio/test/clients] Summary: ${clientsWithDetails.length} clients with data, ${skippedCount} skipped`);
        clients = clientsWithDetails;
      } else {
        // Якщо вже є дані, фільтруємо тільки тих, хто має дані
        clients = clientsWithData;
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      console.warn('[altegio/test/clients] Direct API failed, trying via appointments...', errorMessage);
      
      // Якщо прямі запити не працюють, спробуємо через appointments
      try {
        const { getUpcomingAppointments } = await import('@/lib/altegio/appointments');
        const appointments = await getUpcomingAppointments(companyId, 90, true);
        
        // Витягуємо унікальних клієнтів з appointments
        const clientsMap = new Map<number, any>();
        for (const apt of appointments) {
          if (apt.client && apt.client.id) {
            const clientId = apt.client.id;
            if (!clientsMap.has(clientId)) {
              clientsMap.set(clientId, apt.client);
            }
          }
        }
        
        clients = Array.from(clientsMap.values()).slice(0, 10);
        source = 'via_appointments';
        console.log(`[altegio/test/clients] ✅ Got ${clients.length} clients via appointments`);
      } catch (appointmentsErr) {
        const appointmentsErrorMessage = appointmentsErr instanceof Error ? appointmentsErr.message : String(appointmentsErr);
        console.error('[altegio/test/clients] Appointments fallback also failed:', appointmentsErrorMessage);
        
        // Якщо і appointments не працюють, повертаємо детальну помилку
        return NextResponse.json({
          ok: false,
          error: `Direct API error: ${errorMessage}. Appointments fallback also failed: ${appointmentsErrorMessage}`,
          directError: errorMessage,
          appointmentsError: appointmentsErrorMessage,
          recommendation: 'Перевірте логи Vercel для деталей. Можливо, потрібно звернутися до підтримки Altegio щодо прав доступу для непублічних програм.',
        }, { status: 500 });
      }
    }
    
    if (clients.length === 0) {
      return NextResponse.json({
        ok: true,
        message: `No clients found (source: ${source})`,
        source,
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
      'instagram-user-name',      // API key (kebab-case)
      'instagram_user_name',      // snake_case
      'instagramUsername',        // camelCase
      'instagram_username',       // інший snake_case варіант
      'instagram',                // коротка назва
      'instagram_user',           // ще варіант
      'insta_username',           // ще варіант
      'instausername',            // без підкреслення
      'insta',                    // дуже коротка назва
      // Також шукаємо за частиною слова
      'gram',
    ];
    
    let instagramFieldFound = false;
    let instagramFieldName: string | null = null;
    let instagramFieldValue: string | null = null;
    
    // Виключаємо стандартні поля з пошуку (name, phone, email не можуть бути Instagram)
    const excludedFields = ['id', 'name', 'phone', 'email', 'created_at', 'updated_at', 'company_id'];
    
    // Перевіряємо всі можливі варіанти назв (точна відповідність)
    for (const variant of instagramFieldVariants) {
      const foundKey = allKeys.find(key => {
        // Пропускаємо виключені поля
        if (excludedFields.includes(key.toLowerCase())) {
          return false;
        }
        const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
        const normalizedVariant = variant.toLowerCase().replace(/[-_]/g, '');
        return normalizedKey === normalizedVariant || 
               normalizedKey.includes(normalizedVariant) ||
               normalizedVariant.includes(normalizedKey);
      });
      
      if (foundKey && firstClient[foundKey]) {
        const value = String(firstClient[foundKey]).trim();
        // Перевіряємо, що значення не є ім'ям клієнта
        if (value && value !== firstClient.name) {
          instagramFieldFound = true;
          instagramFieldName = foundKey;
          instagramFieldValue = value;
          break;
        }
      }
    }
    
    // Якщо не знайдено точну відповідність, шукаємо за ключовими словами в назвах полів
    if (!instagramFieldFound) {
      const instagramKeywords = ['instagram', 'insta', 'gram'];
      for (const keyword of instagramKeywords) {
        const foundKey = allKeys.find(key => {
          // Пропускаємо виключені поля
          if (excludedFields.includes(key.toLowerCase())) {
            return false;
          }
          return key.toLowerCase().includes(keyword.toLowerCase());
        });
        if (foundKey && firstClient[foundKey]) {
          const value = String(firstClient[foundKey]).trim();
          // Перевіряємо, що значення не є ім'ям клієнта
          if (value && value !== firstClient.name) {
            instagramFieldFound = true;
            instagramFieldName = foundKey;
            instagramFieldValue = value;
            break;
          }
        }
      }
    }
    
    // Перевіряємо custom_fields, якщо вони є (пріоритет #1 - там зберігається Instagram username)
    if (!instagramFieldFound && firstClient.custom_fields) {
      console.log('[altegio/test/clients] Checking custom_fields for Instagram:', Object.keys(firstClient.custom_fields));
      
      // Спочатку шукаємо точний API key 'instagram-user-name' (як користувач згадував)
      if (firstClient.custom_fields['instagram-user-name']) {
        instagramFieldFound = true;
        instagramFieldName = 'custom_fields.instagram-user-name';
        instagramFieldValue = String(firstClient.custom_fields['instagram-user-name']).trim();
        console.log('[altegio/test/clients] ✅ Found Instagram in custom_fields.instagram-user-name:', instagramFieldValue);
      } else {
        // Якщо точний ключ не знайдено, шукаємо за варіантами
        for (const variant of instagramFieldVariants) {
          const foundKey = Object.keys(firstClient.custom_fields).find(key => {
            const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
            const normalizedVariant = variant.toLowerCase().replace(/[-_]/g, '');
            return normalizedKey === normalizedVariant || 
                   normalizedKey.includes(normalizedVariant) ||
                   normalizedVariant.includes(normalizedKey);
          });
          
          if (foundKey && firstClient.custom_fields[foundKey]) {
            const value = String(firstClient.custom_fields[foundKey]).trim();
            if (value && value !== firstClient.name) {
              instagramFieldFound = true;
              instagramFieldName = `custom_fields.${foundKey}`;
              instagramFieldValue = value;
              console.log('[altegio/test/clients] ✅ Found Instagram in custom_fields:', instagramFieldName, instagramFieldValue);
              break;
            }
          }
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
    
      // Повна інформація про всіх клієнтів
    const clientsFull = clients.map(client => {
      const clientKeys = Object.keys(client);
      let instagramValue: string | null = null;
      let cardNumber: string | null = null;
      let note: string | null = null;
      
      // Шукаємо Card number (можливі варіанти назв)
      const cardNumberVariants = ['card_number', 'cardNumber', 'card-number', 'card', 'card_id', 'loyalty_card'];
      for (const variant of cardNumberVariants) {
        if (client[variant]) {
          cardNumber = String(client[variant]).trim();
          break;
        }
      }
      
      // Також перевіряємо в custom_fields
      if (!cardNumber && client.custom_fields) {
        for (const variant of cardNumberVariants) {
          if (client.custom_fields[variant]) {
            cardNumber = String(client.custom_fields[variant]).trim();
            break;
          }
        }
      }
      
      // Шукаємо Note (можливі варіанти назв)
      const noteVariants = ['note', 'notes', 'comment', 'comments', 'description', 'remarks'];
      for (const variant of noteVariants) {
        if (client[variant]) {
          note = String(client[variant]).trim();
          break;
        }
      }
      
      // Також перевіряємо в custom_fields
      if (!note && client.custom_fields) {
        for (const variant of noteVariants) {
          if (client.custom_fields[variant]) {
            note = String(client.custom_fields[variant]).trim();
            break;
          }
        }
      }
      
      // Виключаємо стандартні поля з пошуку
      const excludedFields = ['id', 'name', 'phone', 'email', 'created_at', 'updated_at', 'company_id'];
      
      // Шукаємо Instagram в різних варіантах для кожного клієнта
      const instagramVariants = [
        'instagram-user-name', 'instagram_user_name', 'instagramUsername', 
        'instagram_username', 'instagram', 'instagram_user', 'insta_username',
        'instausername', 'insta', 'gram'
      ];
      
      for (const variant of instagramVariants) {
        const foundKey = clientKeys.find(key => {
          // Пропускаємо виключені поля
          if (excludedFields.includes(key.toLowerCase())) {
            return false;
          }
          const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
          const normalizedVariant = variant.toLowerCase().replace(/[-_]/g, '');
          return normalizedKey === normalizedVariant || 
                 normalizedKey.includes(normalizedVariant) ||
                 normalizedVariant.includes(normalizedKey);
        });
        if (foundKey && client[foundKey]) {
          const value = String(client[foundKey]).trim();
          // Перевіряємо, що значення не є ім'ям клієнта
          if (value && value !== client.name) {
            instagramValue = value;
            break;
          }
        }
      }
      
      // Якщо не знайдено точну відповідність, шукаємо за ключовими словами
      if (!instagramValue) {
        const instagramKeywords = ['instagram', 'insta', 'gram'];
        for (const keyword of instagramKeywords) {
          const foundKey = clientKeys.find(key => {
            // Пропускаємо виключені поля
            if (excludedFields.includes(key.toLowerCase())) {
              return false;
            }
            return key.toLowerCase().includes(keyword.toLowerCase());
          });
          if (foundKey && client[foundKey]) {
            const value = String(client[foundKey]).trim();
            // Перевіряємо, що значення не є ім'ям клієнта
            if (value && value !== client.name) {
              instagramValue = value;
              break;
            }
          }
        }
      }
      
      // Також перевіряємо custom_fields
      if (!instagramValue && client.custom_fields) {
        for (const variant of instagramVariants) {
          const foundKey = Object.keys(client.custom_fields).find(key => 
            key.toLowerCase().replace(/[-_]/g, '') === variant.toLowerCase().replace(/[-_]/g, '')
          );
          if (foundKey && client.custom_fields[foundKey]) {
            instagramValue = String(client.custom_fields[foundKey]);
            break;
          }
        }
      }
      
      return {
        id: client.id,
        name: client.name || 'Без імені',
        phone: client.phone || '—',
        email: client.email || '—',
        instagram: instagramValue || '—',
        cardNumber: cardNumber || '—',
        note: note || '—',
        // Повна структура для діагностики (тільки перші 3 символи для полів)
        allFields: Object.fromEntries(
          Object.entries(client).map(([key, value]) => [
            key, 
            typeof value === 'string' && value.length > 100 
              ? value.substring(0, 100) + '...' 
              : value
          ])
        ),
      };
    });
    
    return NextResponse.json({
      ok: true,
      message: `Found ${clients.length} clients (source: ${source})`,
      source,
      clientsCount: clients.length,
      clients: clientsFull,
      firstClientStructure: {
        ...firstClientStructure,
        // Додаємо повну raw структуру для детальної діагностики
        rawStructure: JSON.stringify(firstClient, null, 2),
      },
      instagramFieldFound,
      instagramFieldName,
      instagramFieldValue,
      allKeys: allKeys,
      customFields: customFields,
      note: instagramFieldFound 
        ? `✅ Instagram field found: ${instagramFieldName} = ${instagramFieldValue}`
        : '⚠️ Instagram field not found. Showing full structure below for analysis.',
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

