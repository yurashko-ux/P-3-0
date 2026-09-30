#!/bin/bash

# Простий тест Web Scraper endpoint

echo "🧪 Тестування Web Scraper Endpoint"
echo "=================================="
echo ""

ENDPOINT="https://p-3-0.vercel.app/api/admin/web-scraper"

# Тест 1: GET запит для інформації
echo "📋 Тест 1: GET /api/admin/web-scraper"
curl -s "$ENDPOINT" | jq -r '.endpoint, .description' 2>/dev/null || echo "Очікується JSON відповідь"
echo ""
echo ""

# Тест 2: Простий JSON API
echo "📋 Тест 2: Отримання JSON (GitHub API)"
curl -s -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://api.github.com/users/github","method":"fetch"}' \
  | jq -r 'if .success then "✅ Успішно: \(.data.login) - \(.data.name)" else "❌ Помилка: \(.error)" end' 2>/dev/null || echo "❌ Помилка виконання"
echo ""

# Тест 3: Валідація (невірний URL)
echo "📋 Тест 3: Валідація невірного URL"
curl -s -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{"url":"invalid-url","method":"fetch"}' \
  | jq -r 'if .success then "❌ Має бути помилка" else "✅ Валідація працює: \(.error)" end' 2>/dev/null || echo "❌ Помилка виконання"
echo ""

echo "=================================="
echo "✨ Тести завершено!"
echo ""
echo "💡 Для детальних тестів запустіть:"
echo "   node web/test-web-scraper.js"
echo ""
echo "🌐 Демо сторінка:"
echo "   https://p-3-0.vercel.app/admin/web-scraper-demo"
