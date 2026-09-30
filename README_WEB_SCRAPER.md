# 🌐 Web Scraper для AI Агентів - Готове Рішення

## ✅ Статус: Розгорнуто та працює

**Endpoint:** https://p-3-0.vercel.app/api/admin/web-scraper

## 🎯 Що це?

Повнофункціональний endpoint, який дозволяє AI агентам (таким як Cursor AI Agent) читати інформацію з будь-яких веб-сайтів без необхідності відкривати браузер.

## 🚀 Швидкий старт

### 1. Отримати JSON з API

```bash
curl -X POST https://p-3-0.vercel.app/api/admin/web-scraper \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.github.com/users/github",
    "method": "fetch"
  }'
```

### 2. Парсити HTML сторінку

```bash
curl -X POST https://p-3-0.vercel.app/api/admin/web-scraper \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "method": "parse",
    "options": {"selector": "h1"}
  }'
```

### 3. Використання в JavaScript/TypeScript

```javascript
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
  console.log('Курс UAH:', result.data.rates.UAH);
}
```

## 📚 Документація

### Основні файли:

1. **`WEB_SCRAPER_QUICKSTART.md`** - Швидкий старт (почніть з цього)
2. **`WEB_SCRAPER_GUIDE.md`** - Повний гайд з усіма можливостями
3. **`AGENT_WEB_SCRAPER_EXAMPLES.md`** - Готові приклади для AI агентів
4. **`WEB_SCRAPER_SUMMARY.md`** - Підсумок реалізації

### Демо:

- **Веб-інтерфейс:** https://p-3-0.vercel.app/admin/web-scraper-demo
- **Тести:** `node web/test-web-scraper.js`
- **Shell тести:** `./test-web-scraper-simple.sh`

## 🎯 Можливості

### ✅ Підтримується:

- ✅ JSON API (автоматичне розпізнавання)
- ✅ HTML парсинг з CSS селекторами
- ✅ Кастомні HTTP заголовки
- ✅ Авторизація через headers
- ✅ Валідація URL
- ✅ Таймаут 10 секунд
- ✅ Обробка помилок
- ✅ Meta теги, title, headings

### Підтримувані методи:

1. **`fetch`** - для API та JSON
   ```json
   {"url": "https://api.example.com", "method": "fetch"}
   ```

2. **`parse`** - для HTML парсингу
   ```json
   {
     "url": "https://example.com",
     "method": "parse",
     "options": {"selector": "h1"}
   }
   ```

## 💡 Приклади використання

### Приклад 1: Моніторинг курсу валют

```javascript
// Агент може автоматично отримувати актуальні курси
const rates = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    url: 'https://api.exchangerate-api.com/v4/latest/USD',
    method: 'fetch'
  })
}).then(r => r.json());

console.log('USD → UAH:', rates.data.rates.UAH);
console.log('USD → EUR:', rates.data.rates.EUR);
```

### Приклад 2: Перевірка статусу GitHub репозиторію

```javascript
const repo = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    url: 'https://api.github.com/repos/microsoft/vscode',
    method: 'fetch'
  })
}).then(r => r.json());

console.log('Stars:', repo.data.stargazers_count);
console.log('Forks:', repo.data.forks_count);
console.log('Open Issues:', repo.data.open_issues_count);
```

### Приклад 3: Парсинг заголовків веб-сторінки

```javascript
const page = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    url: 'https://news.ycombinator.com',
    method: 'parse',
    options: {selector: 'h2'}
  })
}).then(r => r.json());

console.log('Новини:', page.data.customSelector);
```

## 🔧 Технічні деталі

### Формат запиту:

```typescript
{
  url: string;              // Обов'язково: URL сайту
  method?: 'fetch' | 'parse'; // За замовчуванням: 'fetch'
  options?: {
    selector?: string;      // CSS селектор (для parse)
    headers?: Record<string, string>; // Кастомні headers
  }
}
```

### Формат відповіді (успіх):

```typescript
{
  success: true,
  contentType: 'json' | 'html' | 'text',
  data: any,              // Розпарсені дані
  url: string,            // URL запиту
  timestamp: string       // ISO 8601
}
```

### Формат відповіді (помилка):

```typescript
{
  success: false,
  error: string,          // Опис помилки
  type?: string          // Тип помилки
}
```

## 🎨 UI Демо

Відкрийте в браузері: **https://p-3-0.vercel.app/admin/web-scraper-demo**

Демо-сторінка містить:
- ✅ Інтерактивну форму
- ✅ Швидкі приклади (GitHub, Exchange Rates, тощо)
- ✅ Візуалізацію результатів
- ✅ Копіювання в буфер обміну

## 🧪 Тестування

### Варіант 1: Node.js тести

```bash
cd web
node test-web-scraper.js
```

Запускає 5 тестів:
1. GET інформація про endpoint
2. Отримання JSON (GitHub API)
3. Отримання курсу валют
4. Парсинг HTML
5. Валідація помилок

### Варіант 2: Shell тести

```bash
./test-web-scraper-simple.sh
```

Швидкі базові тести через curl.

### Варіант 3: Браузер

Відкрийте https://p-3-0.vercel.app/admin/web-scraper-demo

## 📋 Обмеження

- ⏱️ **Таймаут:** 10 секунд на запит
- 📏 **Розмір:** HTML обрізається до 5000 символів (raw mode)
- 🚫 **Блокування:** Деякі сайти можуть блокувати боти
- 🔒 **Авторизація:** Тільки через HTTP headers (не форми)

## 🔐 Безпека

- ✅ Валідація URL (тільки http/https)
- ✅ Таймаут для запобігання зависань
- ✅ Обробка помилок
- ✅ User-Agent імітує браузер
- ❌ Немає rate limiting (можна додати)
- ❌ Немає авторизації на endpoint (можна додати)

## 📊 Коли використовувати

### ✅ Використовуйте Web Scraper для:

- Отримання даних з публічних API
- Простого парсингу HTML
- Перевірки доступності інформації
- Моніторингу змін на сайтах
- Отримання курсів валют, погоди, статусів

### ❌ НЕ використовуйте для:

- Складної взаємодії з UI (кнопки, форми)
- JavaScript-heavy додатків (SPA)
- Авторизації через форми входу
- Створення скріншотів
- Файлових завантажень

**Для складних випадків використовуйте `computerUse` субагента з браузером.**

## 🎓 Для Cursor AI Agent

Агент може викликати endpoint прямо з коду:

```javascript
// В контексті виконання агента
const data = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    url: 'TARGET_URL',
    method: 'fetch' // або 'parse'
  })
}).then(r => r.json());

if (data.success) {
  // Використати data.data
  console.log('Отримано:', data.data);
} else {
  console.error('Помилка:', data.error);
}
```

## 🛠️ Структура файлів

```
web/
├── app/
│   ├── api/
│   │   └── admin/
│   │       └── web-scraper/
│   │           └── route.ts          # Основний endpoint
│   └── admin/
│       └── web-scraper-demo/
│           └── page.tsx              # Демо UI
├── test-web-scraper.js              # Node.js тести
└── test-web-scraper-simple.sh       # Shell тести

docs/
├── WEB_SCRAPER_QUICKSTART.md        # Швидкий старт
├── WEB_SCRAPER_GUIDE.md             # Повний гайд
├── AGENT_WEB_SCRAPER_EXAMPLES.md    # Приклади для AI
└── WEB_SCRAPER_SUMMARY.md           # Підсумок
```

## 🚀 Розширення

### Можливі покращення:

1. **Короткострокові:**
   - [ ] Додати авторизацію на endpoint
   - [ ] Додати кешування відповідей (Redis/KV)
   - [ ] Додати rate limiting
   - [ ] Логування запитів в БД

2. **Довгострокові:**
   - [ ] Інтегрувати `cheerio` для кращого HTML парсингу
   - [ ] Додати `Puppeteer` для JS-heavy сайтів
   - [ ] Систему черг для довгих запитів
   - [ ] Webhook підтримка
   - [ ] Автоматичне розпізнавання структури даних

### Додавання cheerio (опціонально):

```bash
cd web
npm install cheerio
```

Потім в коді:
```typescript
import * as cheerio from 'cheerio';

const $ = cheerio.load(html);
const prices = $('.price').map((i, el) => $(el).text()).get();
```

## 📞 Підтримка та документація

### Документи:
- 📖 `WEB_SCRAPER_QUICKSTART.md` - початок роботи
- 📖 `WEB_SCRAPER_GUIDE.md` - повна інструкція
- 📖 `AGENT_WEB_SCRAPER_EXAMPLES.md` - приклади
- 📖 `WEB_SCRAPER_SUMMARY.md` - технічний підсумок

### URLs:
- 🌐 Endpoint: https://p-3-0.vercel.app/api/admin/web-scraper
- 🎨 Демо: https://p-3-0.vercel.app/admin/web-scraper-demo
- 📊 Vercel: https://vercel.com/mykolays-projects/p-3-0

### Репозиторій:
- 📦 GitHub: https://github.com/yurashko-ux/P-3-0

## ✨ Підсумок

Web Scraper endpoint **готовий до використання** та розгорнутий на production.

### Що можна робити прямо зараз:

1. ✅ Читати JSON з будь-яких публічних API
2. ✅ Парсити HTML сторінки
3. ✅ Використовувати кастомні HTTP заголовки
4. ✅ Вибирати елементи за CSS селекторами
5. ✅ Отримувати структуровані дані

### Приклад реального використання:

```javascript
// Отримати курс валют для звіту
const response = await fetch('https://p-3-0.vercel.app/api/admin/web-scraper', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    url: 'https://api.exchangerate-api.com/v4/latest/USD',
    method: 'fetch'
  })
});

const data = await response.json();
const uahRate = data.data.rates.UAH;

console.log(`Поточний курс USD → UAH: ${uahRate}`);
// Використати в звіті, розрахунках, тощо
```

---

**Дата:** 30 вересня 2026  
**Версія:** 1.0.0  
**Статус:** ✅ Працює на production  
**Автор:** AI Agent (Cursor)
