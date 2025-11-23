# Як протестувати Altegio API без Postman

## Що таке Postman?

Postman — це додаток з графічним інтерфейсом для тестування API. Але вам він не обов'язковий!

## Варіант 1: Використати наш власний тестовий endpoint (НАЙПРОСТІШЕ ✅)

Ми вже створили тестові endpoints у вашому проєкті. Просто відкрийте у браузері:

1. **Перевірка підключення:**
   ```
   https://your-domain.vercel.app/api/altegio/test
   ```
   Має повернути інформацію про компанію.

2. **Тест отримання клієнтів:**
   ```
   https://your-domain.vercel.app/api/altegio/test/clients
   ```
   Це покаже помилку 403, яку можна зробити скріншот.

3. **Тест отримання записів:**
   ```
   https://your-domain.vercel.app/api/altegio/test/appointments
   ```
   Це теж покаже помилку 403.

**Скріншот у браузері достатньо для підтримки!** Покажіть URL і повідомлення про помилку.

---

## Варіант 2: Використати curl у терміналі (якщо знайомий з терміналом)

Якщо у вас macOS або Linux, можна використати `curl` у терміналі:

```bash
# Тест 1: Отримати компанії (має працювати)
curl -X GET "https://api.alteg.io/api/v1/companies" \
  -H "Accept: application/vnd.api.v2+json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 48kfgfmy8s7u84ruhtju, User YOUR_USER_TOKEN_HERE"

# Тест 2: Отримати клієнтів (має повернути 403)
curl -X POST "https://api.alteg.io/api/v1/clients" \
  -H "Accept: application/vnd.api.v2+json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 48kfgfmy8s7u84ruhtju, User YOUR_USER_TOKEN_HERE" \
  -H "X-Partner-ID: 784" \
  -H "X-Application-ID: 1195" \
  -d '{"company_id": 1169323}'
```

**Замініть `YOUR_USER_TOKEN_HERE` на ваш токен з Vercel environment variables.**

---

## Варіант 3: Встановити Postman (якщо хочете спробувати)

### Як встановити Postman:

1. **macOS:**
   - Відкрийте App Store → знайдіть "Postman"
   - Або завантажте з https://www.postman.com/downloads/
   - Встановіть як звичайний додаток

2. **Windows:**
   - Завантажте з https://www.postman.com/downloads/
   - Встановіть .exe файл

3. **Linux:**
   - Завантажте з https://www.postman.com/downloads/
   - Або встановіть через Snap: `snap install postman`

### Як використовувати:

1. Відкрийте Postman
2. Натисніть "Import" (імпортувати)
3. Виберіть файл `ALTEGIO_POSTMAN_COLLECTION.json` з вашого проєкту
4. Оновіть змінну `ALTEGIO_USER_TOKEN` (ваш токен)
5. Натисніть "Send" (надіслати) на кожному запиті

---

## Рекомендація: Варіант 1 (наш endpoint) ✅

**Найпростіше:** просто відкрийте у браузері:
- `/api/altegio/test/clients` 
- `/api/altegio/test/appointments`

Зробіть скріншот помилки 403 — цього достатньо для підтримки!

Або можу створити спеціальну тестову сторінку на `/admin/altegio` з кнопкою "Показати помилку для підтримки", яка виведе всі деталі одним скріншотом.

---

## Що відправити підтримці

1. Скріншот помилки з браузера (URL + помилка)
2. Файл `tokens.json` з токенами (окремо, безпечно)
3. Текст листа з `ALTEGIO_SUPPORT_EMAIL_EN.md`

Цього буде достатньо!

