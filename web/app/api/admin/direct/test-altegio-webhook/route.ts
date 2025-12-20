// web/app/api/admin/direct/test-altegio-webhook/route.ts
// Тестовий endpoint для симуляції Altegio webhook з custom_fields

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Тестовий endpoint для симуляції Altegio webhook
 * Дозволяє протестувати обробку custom_fields з різними структурами
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    
    const { clientId, customFieldsFormat } = body;
    
    if (!clientId) {
      return NextResponse.json({
        ok: false,
        error: 'clientId is required',
      }, { status: 400 });
    }

    // Різні формати custom_fields для тестування
    const customFieldsVariants: Record<string, any> = {
      // Варіант 1: Масив об'єктів з title/value (як в API)
      array_title_value: [
        {
          id: 93763,
          title: 'Instagram user name',
          value: 'test_instagram_user',
        },
      ],
      // Варіант 2: Масив об'єктів з name/value
      array_name_value: [
        {
          id: 93763,
          name: 'Instagram user name',
          value: 'test_instagram_user',
        },
      ],
      // Варіант 3: Об'єкт з ключами (як в деяких вебхуках)
      object_keys: {
        'instagram-user-name': 'test_instagram_user',
      },
      // Варіант 4: Об'єкт з camelCase
      object_camel: {
        instagram_user_name: 'test_instagram_user',
      },
      // Варіант 5: Об'єкт з пробілами
      object_spaces: {
        'Instagram user name': 'test_instagram_user',
      },
      // Варіант 6: Порожній масив
      empty_array: [],
      // Варіант 7: null
      null_value: null,
    };

    const selectedFormat = customFieldsFormat || 'array_title_value';
    const customFields = customFieldsVariants[selectedFormat] || customFieldsVariants.array_title_value;

    // Симулюємо вебхук подію client.update
    const webhookPayload = {
      resource: 'client',
      resource_id: parseInt(String(clientId), 10),
      status: 'update',
      data: {
        client: {
          id: parseInt(String(clientId), 10),
          name: 'Тестовий Клієнт',
          display_name: 'Тестовий Клієнт',
          phone: '+380123456789',
          email: 'test@example.com',
          custom_fields: customFields,
        },
      },
    };

    console.log('[direct/test-altegio-webhook] Simulating webhook:', {
      clientId,
      customFieldsFormat: selectedFormat,
      customFields,
      webhookPayload,
    });

    // Викликаємо реальний вебхук endpoint напряму (внутрішній виклик)
    let webhookResponse: any = null;
    let webhookError: string | null = null;

    try {
      // Імпортуємо та викликаємо вебхук функцію напряму
      const { POST: webhookPOST } = await import('@/app/api/altegio/webhook/route');
      const mockRequest = new Request('http://localhost:3000/api/altegio/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(webhookPayload),
      });
      
      const response = await webhookPOST(mockRequest as any);
      webhookResponse = await response.json().catch(() => ({ raw: await response.text() }));
    } catch (err) {
      webhookError = err instanceof Error ? err.message : String(err);
      console.error('[direct/test-altegio-webhook] Webhook call error:', err);
    }

    // Тестуємо логіку витягування Instagram (як у вебхуку)
    let instagram: string | null = null;
    const extractionSteps: any[] = [];

    if (customFields) {
      extractionSteps.push({
        step: 'check_custom_fields_exists',
        result: true,
        type: typeof customFields,
        isArray: Array.isArray(customFields),
      });

      // Варіант 1: custom_fields - це масив об'єктів
      if (Array.isArray(customFields)) {
        extractionSteps.push({
          step: 'try_array_extraction',
          arrayLength: customFields.length,
        });

        for (const field of customFields) {
          if (field && typeof field === 'object') {
            const title = field.title || field.name || field.label || '';
            const value = field.value || field.data || field.content || field.text || '';
            
            extractionSteps.push({
              step: 'check_field',
              field,
              title,
              value,
              matchesInstagram: /instagram/i.test(title),
            });

            if (value && typeof value === 'string' && /instagram/i.test(title)) {
              instagram = value.trim();
              extractionSteps.push({
                step: 'found_instagram',
                instagram,
                source: 'array_title_value',
              });
              break;
            }
          }
        }
      }
      // Варіант 2: custom_fields - це об'єкт
      else if (typeof customFields === 'object' && !Array.isArray(customFields)) {
        extractionSteps.push({
          step: 'try_object_extraction',
          keys: Object.keys(customFields),
        });

        instagram =
          customFields['instagram-user-name'] ||
          customFields['Instagram user name'] ||
          customFields.instagram_user_name ||
          customFields.instagramUsername ||
          customFields.instagram ||
          customFields['instagram'] ||
          null;

        if (instagram) {
          extractionSteps.push({
            step: 'found_instagram',
            instagram,
            source: 'object_keys',
            foundIn: Object.keys(customFields).find(key => 
              customFields[key] === instagram
            ),
          });
        }
      }
    } else {
      extractionSteps.push({
        step: 'check_custom_fields_exists',
        result: false,
        customFields,
      });
    }

    return NextResponse.json({
      ok: true,
      test: {
        clientId,
        customFieldsFormat: selectedFormat,
        customFields,
        webhookPayload,
      },
      extraction: {
        instagram,
        steps: extractionSteps,
      },
      webhook: {
        response: webhookResponse,
        error: webhookError,
      },
      availableFormats: Object.keys(customFieldsVariants),
      note: 'Використовуй POST з body: { clientId: 176404915, customFieldsFormat: "array_title_value" }',
    });
  } catch (err) {
    console.error('[direct/test-altegio-webhook] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

/**
 * GET endpoint для перегляду доступних форматів
 */
export async function GET(req: NextRequest) {
  return NextResponse.json({
    ok: true,
    message: 'Тестовий endpoint для симуляції Altegio webhook',
    usage: {
      method: 'POST',
      body: {
        clientId: 'number (required)',
        customFieldsFormat: 'string (optional, one of: array_title_value, array_name_value, object_keys, object_camel, object_spaces, empty_array, null_value)',
      },
      example: {
        clientId: 176404915,
        customFieldsFormat: 'array_title_value',
      },
    },
    availableFormats: [
      'array_title_value - Масив об\'єктів з title/value (як в API)',
      'array_name_value - Масив об\'єктів з name/value',
      'object_keys - Об\'єкт з ключами (як в деяких вебхуках)',
      'object_camel - Об\'єкт з camelCase',
      'object_spaces - Об\'єкт з пробілами',
      'empty_array - Порожній масив',
      'null_value - null',
    ],
  });
}
