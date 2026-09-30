# Приклади використання Web Scraper для AI Агентів

## Огляд

Web Scraper endpoint дозволяє AI агентам читати інформацію з будь-яких веб-сайтів без необходимості відкривати браузер.

**Endpoint:** `https://p-3-0.vercel.app/api/admin/web-scraper`

## Приклади для Cursor AI Agent

### Приклад 1: Отримання курсу валют

```javascript
// Агент може виконати цей код для отримання актуального курсу валют
const response = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://api.exchangerate-api.com/v4/latest/USD',
    method: 'fetch'
  })
});

const result = await response.json();
if (result.success) {
  console.log('Курс USD → UAH:', result.data.rates.UAH);
  console.log('Курс USD → EUR:', result.data.rates.EUR);
}
```

### Приклад 2: Перевірка наявності інформації на сайті

```javascript
// Перевірити, чи є певна інформація на сайті конкурента
const response = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://competitor.com/prices',
    method: 'parse',
    options: {
      selector: '.price'
    }
  })
});

const result = await response.json();
if (result.success && result.data.customSelector) {
  console.log('Знайдено цін:', result.data.customSelector.length);
  console.log('Ціни:', result.data.customSelector);
}
```

### Приклад 3: Моніторинг статусу сервісу

```javascript
// Перевірити статус зовнішнього API
const response = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://status.myservice.com/api/status',
    method: 'fetch'
  })
});

const result = await response.json();
if (result.success) {
  console.log('Статус сервісу:', result.data.status);
  console.log('Всі системи працюють:', result.data.allSystemsOperational);
}
```

### Приклад 4: Отримання інформації про користувача GitHub

```javascript
const username = 'github';
const response = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: `https://api.github.com/users/${username}`,
    method: 'fetch'
  })
});

const result = await response.json();
if (result.success) {
  console.log('Username:', result.data.login);
  console.log('Name:', result.data.name);
  console.log('Public repos:', result.data.public_repos);
  console.log('Followers:', result.data.followers);
}
```

### Приклад 5: Парсинг заголовків новин

```javascript
const response = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://news.ycombinator.com',
    method: 'parse',
    options: {
      selector: 'h2'
    }
  })
});

const result = await response.json();
if (result.success) {
  console.log('Заголовки новин:', result.data.headings.h2);
}
```

### Приклад 6: Перевірка доступності товару

```javascript
const response = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://shop.example.com/product/123',
    method: 'parse',
    options: {
      selector: '.in-stock'
    }
  })
});

const result = await response.json();
if (result.success) {
  const inStock = result.data.customSelector.length > 0;
  console.log('Товар в наявності:', inStock);
}
```

## Використання в Shell команді (curl)

Агент може виконати curl команду для отримання даних:

```bash
curl -X POST https://p-3-0.vercel.app/api/admin/web-scraper \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.github.com/repos/microsoft/vscode",
    "method": "fetch"
  }' | jq '.data | {name, description, stars: .stargazers_count}'
```

## Інтеграція з робочим процесом агента

### Сценарій: Агент збирає дані для звіту

```javascript
// Крок 1: Отримати курс валют
const exchangeRates = await fetchWebData('https://api.exchangerate-api.com/v4/latest/USD');

// Крок 2: Отримати статистику GitHub
const githubStats = await fetchWebData('https://api.github.com/users/mycompany');

// Крок 3: Перевірити статус сервісу
const serviceStatus = await fetchWebData('https://status.myservice.com/api/v1/status');

// Крок 4: Створити звіт
console.log('=== Щоденний звіт ===');
console.log('Курс UAH:', exchangeRates.rates.UAH);
console.log('GitHub stars:', githubStats.public_repos);
console.log('Статус сервісу:', serviceStatus.status);

// Допоміжна функція
async function fetchWebData(url) {
  const response = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, method: 'fetch' })
  });
  const result = await response.json();
  return result.success ? result.data : null;
}
```

## Типові помилки та їх вирішення

### Помилка: "Невірний формат URL"

```javascript
// ❌ Неправильно
{ url: 'google.com' }

// ✅ Правильно
{ url: 'https://google.com' }
```

### Помилка: Таймаут

```javascript
// Якщо запит занадто довгий (> 10 секунд), отримаєте помилку таймауту
// Рішення: спробуйте інший endpoint або перевірте доступність сайту
```

### Помилка: Сайт блокує боти

```javascript
// Деякі сайти блокують запити від серверів
// Рішення: використайте computerUse субагента для складних випадків
```

## Коли використовувати Web Scraper

✅ **Використовуйте Web Scraper коли:**
- Потрібно отримати дані з публічного API
- Потрібно зчитати простий контент з HTML сторінки
- Потрібно перевірити доступність інформації
- Потрібно отримати структуровані дані (JSON)

❌ **НЕ використовуйте Web Scraper коли:**
- Потрібно натискати кнопки або заповнювати форми
- Потрібно працювати з JavaScript-heavy додатками
- Потрібно авторизуватися через форму входу
- Потрібно робити скріншоти

Для складних випадків використовуйте **computerUse субагента**.

## Поради для агентів

1. **Перевіряйте успішність:** завжди перевіряйте `result.success` перед використанням даних
2. **Обробляйте помилки:** використовуйте try-catch для обробки мережевих помилок
3. **Кешуйте результати:** якщо дані не змінюються часто, збережіть їх локально
4. **Поважайте rate limits:** не робіть занадто багато запитів до одного сайту
5. **Використовуйте правильний метод:** `fetch` для API, `parse` для HTML

## Додаткові ресурси

- Повна документація: `WEB_SCRAPER_GUIDE.md`
- Тестовий скрипт: `web/test-web-scraper.js`
- Демо сторінка: `https://p-3-0.vercel.app/admin/web-scraper-demo`
- Код endpoint'у: `web/app/api/admin/web-scraper/route.ts`

## Приклад комплексного використання

```javascript
// Агент створює звіт про конкурентів
async function generateCompetitorReport() {
  const competitors = [
    { name: 'Competitor A', url: 'https://competitor-a.com' },
    { name: 'Competitor B', url: 'https://competitor-b.com' },
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    competitors: []
  };

  for (const competitor of competitors) {
    try {
      const response = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: competitor.url,
          method: 'parse',
          options: { selector: 'h1' }
        })
      });

      const result = await response.json();
      
      if (result.success) {
        report.competitors.push({
          name: competitor.name,
          title: result.data.title,
          mainHeading: result.data.headings.h1[0] || 'N/A',
          meta: result.data.meta
        });
      }
    } catch (error) {
      console.error(`Помилка для ${competitor.name}:`, error);
    }
  }

  console.log('Звіт про конкурентів:', JSON.stringify(report, null, 2));
  return report;
}
```

---

**Готово!** Тепер AI агенти можуть легко читати інформацію з будь-яких веб-сайтів. 🚀
