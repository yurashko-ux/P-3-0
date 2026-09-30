# Інструкція: Як агент може читати інформацію з веб-сайтів

## Огляд

Створено endpoint `/api/admin/web-scraper`, який дозволяє агенту читати інформацію з будь-яких веб-сайтів.

**URL endpoint'у:** https://p-3-0.vercel.app/api/admin/web-scraper

## Методи отримання даних

### 1. Метод `fetch` - для API та структурованих даних

Підходить для:
- REST API
- JSON endpoints
- Публічні API

**Приклад запиту:**
```bash
curl -X POST https://p-3-0.vercel.app/api/admin/web-scraper \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.github.com/users/github",
    "method": "fetch"
  }'
```

**Відповідь:**
```json
{
  "success": true,
  "contentType": "json",
  "data": {
    "login": "github",
    "id": 9919,
    "name": "GitHub"
  },
  "url": "https://api.github.com/users/github",
  "timestamp": "2026-09-30T13:00:00.000Z"
}
```

### 2. Метод `parse` - для HTML сторінок

Підходить для:
- Звичайні веб-сторінки
- Парсинг конкретних елементів
- Отримання заголовків, meta-тегів тощо

**Приклад запиту:**
```bash
curl -X POST https://p-3-0.vercel.app/api/admin/web-scraper \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "method": "parse",
    "options": {
      "selector": "h1"
    }
  }'
```

**Відповідь:**
```json
{
  "success": true,
  "contentType": "html",
  "method": "parsed",
  "data": {
    "title": "Example Domain",
    "meta": {
      "description": "Example website",
      "keywords": "example, demo"
    },
    "headings": {
      "h1": ["Example Domain"],
      "h2": ["More Information"],
      "h3": []
    },
    "customSelector": ["Example Domain"]
  },
  "rawHtmlLength": 1256,
  "url": "https://example.com",
  "timestamp": "2026-09-30T13:00:00.000Z"
}
```

## Додаткові опції

### Кастомні HTTP заголовки

Для API, які потребують авторизації:

```json
{
  "url": "https://api.example.com/protected",
  "method": "fetch",
  "options": {
    "headers": {
      "Authorization": "Bearer YOUR_API_TOKEN",
      "X-Custom-Header": "value"
    }
  }
}
```

### CSS селектори

Підтримувані селектори:
- За класом: `.class-name`
- За ID: `#element-id`
- За тегом: `h1`, `p`, `div` тощо

**Приклад:**
```json
{
  "url": "https://example.com",
  "method": "parse",
  "options": {
    "selector": ".product-price"
  }
}
```

## Використання в коді (TypeScript/JavaScript)

### Простий приклад

```typescript
async function getWebsiteData(url: string) {
  const response = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      method: 'fetch',
    }),
  });

  const result = await response.json();
  
  if (result.success) {
    return result.data;
  } else {
    throw new Error(result.error);
  }
}

// Використання
const data = await getWebsiteData('https://api.example.com/data');
console.log(data);
```

### Парсинг HTML

```typescript
async function parseHtmlPage(url: string, selector: string) {
  const response = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      method: 'parse',
      options: {
        selector: selector,
      },
    }),
  });

  const result = await response.json();
  return result;
}

// Отримати всі H1 заголовки з сайту
const headings = await parseHtmlPage('https://example.com', 'h1');
console.log(headings.data.customSelector);
```

## Використання з Cursor AI Agent

Агент може використовувати цей endpoint для отримання інформації з веб-сайтів:

```javascript
// Агент виконує команду
const result = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://api.exchangerate-api.com/v4/latest/USD',
    method: 'fetch'
  })
});

const data = await result.json();
console.log('Курси валют:', data.data.rates);
```

## Обмеження та безпека

1. **Таймаут:** 10 секунд на запит
2. **Розмір відповіді:** HTML обрізається до 5000 символів (для методу `fetch` без `parse`)
3. **Блокування:** Деякі сайти можуть блокувати запити від серверів
4. **Rate limiting:** Уникайте надто частих запитів до одного сайту

## Для складніших випадків

Якщо потрібно:
- Взаємодіяти з JavaScript на сторінці
- Натискати кнопки
- Заповнювати форми
- Працювати з динамічним контентом

Використовуйте **computerUse субагента** з браузером:

```typescript
// Використання computerUse для складної взаємодії
// Агент може відкрити Chrome і виконати дії в браузері
```

## Приклади реальних використань

### 1. Отримання курсу валют

```bash
curl -X POST https://p-3-0.vercel.app/api/admin/web-scraper \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.exchangerate-api.com/v4/latest/USD",
    "method": "fetch"
  }'
```

### 2. Парсинг прайс-листа конкурентів

```bash
curl -X POST https://p-3-0.vercel.app/api/admin/web-scraper \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://competitor.com/prices",
    "method": "parse",
    "options": {
      "selector": ".price"
    }
  }'
```

### 3. Перевірка статусу сервісу

```bash
curl -X POST https://p-3-0.vercel.app/api/admin/web-scraper \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://status.example.com/api/status",
    "method": "fetch"
  }'
```

## Додаткові можливості

### Інформація про endpoint

Щоб подивитись довідку та приклади:

```bash
curl https://p-3-0.vercel.app/api/admin/web-scraper
```

або відкрийте в браузері: https://p-3-0.vercel.app/api/admin/web-scraper

## Розширення функціоналу

Для більш складного парсингу HTML можна додати бібліотеки:

1. **cheerio** - jQuery-подібний API для серверного парсингу
2. **jsdom** - повноцінний DOM для Node.js
3. **puppeteer** - автоматизація браузера

Приклад додавання cheerio:

```bash
cd web
npm install cheerio
```

Потім у коді:
```typescript
import * as cheerio from 'cheerio';

const $ = cheerio.load(html);
const prices = $('.price').map((i, el) => $(el).text()).get();
```

## Підтримка

Якщо виникають проблеми:
1. Перевірте URL (має бути валідним)
2. Перевірте, чи сайт доступний (не блокує боти)
3. Подивіться логи в Vercel Dashboard
4. Використайте GET запит для перегляду прикладів

## Наступні кроки

1. ✅ Базовий endpoint створено
2. 🔄 Можна додати авторизацію для доступу до endpoint'у
3. 🔄 Можна додати кешування відповідей
4. 🔄 Можна додати більш потужний парсер (cheerio)
5. 🔄 Можна додати інтеграцію з Puppeteer для складних випадків

---

**Готово!** Тепер агент може читати інформацію з будь-яких веб-сайтів через цей endpoint.
