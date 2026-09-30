# Web Scraper - Швидкий Старт

## 🚀 Що це?

Endpoint, який дозволяє агентам та додаткам читати інформацію з будь-яких веб-сайтів.

**URL:** https://p-3-0.vercel.app/api/admin/web-scraper

## ⚡ Швидкі приклади

### 1. Отримати JSON з API

```bash
curl -X POST https://p-3-0.vercel.app/api/admin/web-scraper \
  -H "Content-Type: application/json" \
  -d '{"url":"https://api.github.com/users/github","method":"fetch"}'
```

### 2. Парсити HTML сторінку

```bash
curl -X POST https://p-3-0.vercel.app/api/admin/web-scraper \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","method":"parse","options":{"selector":"h1"}}'
```

### 3. Отримати курс валют

```bash
curl -X POST https://p-3-0.vercel.app/api/admin/web-scraper \
  -H "Content-Type: application/json" \
  -d '{"url":"https://api.exchangerate-api.com/v4/latest/USD","method":"fetch"}'
```

## 📋 Формат запиту

```json
{
  "url": "https://example.com",
  "method": "fetch",
  "options": {
    "selector": "h1",
    "headers": {
      "Authorization": "Bearer token"
    }
  }
}
```

**Поля:**
- `url` (обов'язково) - URL сайту
- `method` - `"fetch"` (для API) або `"parse"` (для HTML)
- `options.selector` - CSS селектор (тільки для parse)
- `options.headers` - Кастомні HTTP заголовки

## 📱 Демо сторінка

Відкрийте в браузері: https://p-3-0.vercel.app/admin/web-scraper-demo

## 📚 Детальна документація

- **Повний гайд:** `WEB_SCRAPER_GUIDE.md`
- **Приклади для AI:** `AGENT_WEB_SCRAPER_EXAMPLES.md`
- **Тестовий скрипт:** `web/test-web-scraper.js`

## 🔧 Тестування

```bash
# Запустити тестовий скрипт
cd web
node test-web-scraper.js
```

## ✅ Готово!

Endpoint вже розгорнуто і готовий до використання. Просто робіть POST запити на вказаний URL.
