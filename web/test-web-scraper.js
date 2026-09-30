#!/usr/bin/env node

/**
 * Тестовий скрипт для перевірки web-scraper endpoint
 * 
 * Запуск:
 * node web/test-web-scraper.js
 */

const BASE_URL = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000';

const ENDPOINT = `${BASE_URL}/api/admin/web-scraper`;

console.log('🚀 Тестування Web Scraper');
console.log('📍 Endpoint:', ENDPOINT);
console.log('');

// Тест 1: GET запит для інформації
async function test1_GetInfo() {
  console.log('📋 Тест 1: Отримання інформації про endpoint');
  try {
    const response = await fetch(ENDPOINT);
    const data = await response.json();
    console.log('✅ Успішно');
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ Помилка:', error.message);
  }
  console.log('');
}

// Тест 2: Отримання JSON з публічного API
async function test2_FetchJsonApi() {
  console.log('📋 Тест 2: Отримання даних з JSON API (GitHub)');
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://api.github.com/users/github',
        method: 'fetch',
      }),
    });

    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Успішно отримано дані:');
      console.log('   Логін:', data.data.login);
      console.log('   Ім\'я:', data.data.name);
      console.log('   ID:', data.data.id);
      console.log('   URL:', data.url);
    } else {
      console.error('❌ Помилка:', data.error);
    }
  } catch (error) {
    console.error('❌ Помилка:', error.message);
  }
  console.log('');
}

// Тест 3: Отримання курсу валют
async function test3_FetchExchangeRate() {
  console.log('📋 Тест 3: Отримання курсу валют');
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://api.exchangerate-api.com/v4/latest/USD',
        method: 'fetch',
      }),
    });

    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Успішно отримано курси валют:');
      console.log('   USD → EUR:', data.data.rates.EUR);
      console.log('   USD → UAH:', data.data.rates.UAH);
      console.log('   USD → GBP:', data.data.rates.GBP);
      console.log('   Дата:', data.data.date);
    } else {
      console.error('❌ Помилка:', data.error);
    }
  } catch (error) {
    console.error('❌ Помилка:', error.message);
  }
  console.log('');
}

// Тест 4: Парсинг HTML сторінки
async function test4_ParseHtml() {
  console.log('📋 Тест 4: Парсинг HTML сторінки (example.com)');
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://example.com',
        method: 'parse',
        options: {
          selector: 'h1',
        },
      }),
    });

    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Успішно розпарсено:');
      console.log('   Title:', data.data.title);
      console.log('   H1 заголовки:', data.data.headings.h1);
      console.log('   Meta description:', data.data.meta.description || 'немає');
      console.log('   Кастомний селектор:', data.data.customSelector);
    } else {
      console.error('❌ Помилка:', data.error);
    }
  } catch (error) {
    console.error('❌ Помилка:', error.message);
  }
  console.log('');
}

// Тест 5: Помилка (невалідний URL)
async function test5_InvalidUrl() {
  console.log('📋 Тест 5: Тест валідації (невалідний URL)');
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'not-a-valid-url',
        method: 'fetch',
      }),
    });

    const data = await response.json();
    
    if (!data.success && data.error) {
      console.log('✅ Валідація працює коректно');
      console.log('   Помилка:', data.error);
    } else {
      console.error('❌ Валідація не спрацювала');
    }
  } catch (error) {
    console.error('❌ Помилка:', error.message);
  }
  console.log('');
}

// Запуск всіх тестів
async function runAllTests() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  await test1_GetInfo();
  await test2_FetchJsonApi();
  await test3_FetchExchangeRate();
  await test4_ParseHtml();
  await test5_InvalidUrl();

  console.log('═══════════════════════════════════════════════════════');
  console.log('✨ Всі тести завершено!');
  console.log('');
  console.log('💡 Endpoint готовий до використання:');
  console.log(`   ${ENDPOINT}`);
  console.log('');
  console.log('📚 Детальна документація: WEB_SCRAPER_GUIDE.md');
}

// Запуск
runAllTests().catch(console.error);
