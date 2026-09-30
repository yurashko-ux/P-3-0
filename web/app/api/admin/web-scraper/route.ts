import { NextResponse } from 'next/server';

// Типи для валідації
interface RequestBody {
  url: string;
  method?: 'fetch' | 'parse';
  options?: {
    headers?: Record<string, string>;
    selector?: string;
  };
}

// Валідація URL
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Валідація запиту
function validateRequest(body: any): { valid: true; data: RequestBody } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Невірний формат запиту' };
  }

  if (!body.url || typeof body.url !== 'string') {
    return { valid: false, error: 'Поле url обов\'язкове' };
  }

  if (!isValidUrl(body.url)) {
    return { valid: false, error: 'Невірний формат URL' };
  }

  const method = body.method || 'fetch';
  if (method !== 'fetch' && method !== 'parse') {
    return { valid: false, error: 'method має бути "fetch" або "parse"' };
  }

  return {
    valid: true,
    data: {
      url: body.url,
      method,
      options: body.options,
    },
  };
}

/**
 * POST /api/admin/web-scraper
 * 
 * Endpoint для читання інформації з веб-сайтів
 * 
 * Приклади використання:
 * 
 * 1. Простий fetch (API):
 * {
 *   "url": "https://api.example.com/data",
 *   "method": "fetch"
 * }
 * 
 * 2. Парсинг HTML:
 * {
 *   "url": "https://example.com/page",
 *   "method": "parse",
 *   "options": {
 *     "selector": "h1, .content"
 *   }
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = validateRequest(body);

    if (!validation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: 'error' in validation ? validation.error : 'Помилка валідації',
        },
        { status: 400 }
      );
    }

    const validated = validation.data;

    console.log('[web-scraper] Запит на отримання даних:', {
      url: validated.url,
      method: validated.method,
    });

    // Базові заголовки для імітації браузера
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
      ...validated.options?.headers,
    };

    // Виконуємо запит
    const response = await fetch(validated.url, {
      headers: defaultHeaders,
      // Додайте таймаут для безпеки
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP помилка: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    let data: any;

    // Обробка різних типів контенту
    if (contentType.includes('application/json')) {
      data = await response.json();
      return NextResponse.json({
        success: true,
        contentType: 'json',
        data,
        url: validated.url,
        timestamp: new Date().toISOString(),
      });
    } else if (contentType.includes('text/html')) {
      const html = await response.text();
      
      if (validated.method === 'parse') {
        // Базовий парсинг HTML (без додаткових бібліотек)
        const parsed = parseHtmlBasic(html, validated.options?.selector);
        
        return NextResponse.json({
          success: true,
          contentType: 'html',
          method: 'parsed',
          data: parsed,
          rawHtmlLength: html.length,
          url: validated.url,
          timestamp: new Date().toISOString(),
        });
      }
      
      return NextResponse.json({
        success: true,
        contentType: 'html',
        method: 'raw',
        html: html.substring(0, 5000), // Обмежуємо розмір відповіді
        fullLength: html.length,
        url: validated.url,
        timestamp: new Date().toISOString(),
        note: 'HTML обрізано до 5000 символів. Використайте method: "parse" з selector для отримання конкретних даних.',
      });
    } else {
      const text = await response.text();
      return NextResponse.json({
        success: true,
        contentType: contentType || 'unknown',
        text: text.substring(0, 5000),
        fullLength: text.length,
        url: validated.url,
        timestamp: new Date().toISOString(),
      });
    }

  } catch (error: any) {
    console.error('[web-scraper] Помилка:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Невідома помилка',
        type: error.name,
      },
      { status: 500 }
    );
  }
}

/**
 * Базовий парсер HTML без зовнішніх залежностей
 * Для складнішого парсингу краще використовувати cheerio або jsdom
 */
function parseHtmlBasic(html: string, selector?: string): any {
  const results: any = {
    title: extractTag(html, 'title'),
    meta: extractMeta(html),
    headings: {
      h1: extractTags(html, 'h1'),
      h2: extractTags(html, 'h2'),
      h3: extractTags(html, 'h3'),
    },
  };

  // Якщо вказано селектор, намагаємось знайти за класом або id
  if (selector) {
    const customMatches = extractBySelector(html, selector);
    if (customMatches.length > 0) {
      results.customSelector = customMatches;
    }
  }

  return results;
}

function extractTag(html: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i');
  const match = html.match(regex);
  return match ? match[1].trim() : null;
}

function extractTags(html: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'gi');
  const matches = html.matchAll(regex);
  return Array.from(matches).map(m => m[1].trim()).filter(Boolean);
}

function extractMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const metaRegex = /<meta\s+([^>]+)>/gi;
  const matches = Array.from(html.matchAll(metaRegex));
  
  for (const match of matches) {
    const attrs = match[1];
    const nameMatch = attrs.match(/name=["']([^"']+)["']/i);
    const contentMatch = attrs.match(/content=["']([^"']+)["']/i);
    const propertyMatch = attrs.match(/property=["']([^"']+)["']/i);
    
    const key = nameMatch?.[1] || propertyMatch?.[1];
    const value = contentMatch?.[1];
    
    if (key && value) {
      meta[key] = value;
    }
  }
  
  return meta;
}

function extractBySelector(html: string, selector: string): string[] {
  const results: string[] = [];
  
  // Спрощений парсинг за класом
  if (selector.startsWith('.')) {
    const className = selector.substring(1);
    const regex = new RegExp(`class=["'][^"']*${className}[^"']*["'][^>]*>([^<]+)`, 'gi');
    const matches = html.matchAll(regex);
    results.push(...Array.from(matches).map(m => m[1].trim()));
  }
  
  // Спрощений парсинг за id
  if (selector.startsWith('#')) {
    const id = selector.substring(1);
    const regex = new RegExp(`id=["']${id}["'][^>]*>([^<]+)`, 'gi');
    const matches = html.matchAll(regex);
    results.push(...Array.from(matches).map(m => m[1].trim()));
  }
  
  // Парсинг за тегом
  if (!selector.startsWith('.') && !selector.startsWith('#')) {
    results.push(...extractTags(html, selector));
  }
  
  return results;
}

/**
 * GET /api/admin/web-scraper
 * 
 * Повертає інформацію про endpoint
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/admin/web-scraper',
    description: 'Endpoint для читання інформації з веб-сайтів',
    methods: ['GET', 'POST'],
    examples: [
      {
        name: 'Отримання JSON з API',
        method: 'POST',
        body: {
          url: 'https://api.example.com/data',
          method: 'fetch',
        },
      },
      {
        name: 'Парсинг HTML сторінки',
        method: 'POST',
        body: {
          url: 'https://example.com',
          method: 'parse',
          options: {
            selector: 'h1',
          },
        },
      },
      {
        name: 'Отримання з кастомними headers',
        method: 'POST',
        body: {
          url: 'https://api.example.com/data',
          method: 'fetch',
          options: {
            headers: {
              'Authorization': 'Bearer YOUR_TOKEN',
            },
          },
        },
      },
    ],
    fullUrl: 'https://p-3-0.vercel.app/api/admin/web-scraper',
  });
}
