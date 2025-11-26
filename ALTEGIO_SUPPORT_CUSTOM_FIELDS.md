# Запит до підтримки Altegio: Отримання custom_fields через API

## Проблема

При використанні Altegio API для отримання клієнтів, API повертає тільки базові поля:
- `id`
- `name`
- `phone`
- `email`
- `last_visit_date`

**НЕ повертаються:**
- `custom_fields` (включаючи кастомні поля, такі як "Instagram user name", "Card number", "Note")
- Інші додаткові поля клієнта

## Спробовані варіанти запитів

### 1. POST /company/{company_id}/clients/search
```json
{
  "page": 1,
  "page_size": 10,
  "fields": ["id", "name", "phone", "email", "custom_fields"],
  "order_by": "last_visit_date",
  "order_by_direction": "desc"
}
```
**Результат:** Повертає тільки базові поля, без `custom_fields`

### 2. GET /company/{company_id}/client/{client_id}
**Варіанти параметрів:**
- `?include[]=custom_fields&with[]=custom_fields&fields[]=custom_fields`
- `?fields[]=id&fields[]=name&fields[]=phone&fields[]=email&fields[]=custom_fields`
- `?include[]=*&with[]=*&fields[]=*`

**Результат:** Повертає тільки базові поля, без `custom_fields`

### 3. POST /company/{company_id}/clients
**Body:**
```json
{
  "include": ["custom_fields"],
  "with": ["custom_fields"]
}
```
**Результат:** Повертає тільки ID клієнтів

## Очікуваний результат

Отримати повну структуру клієнта, включаючи:
- Базові поля (id, name, phone, email)
- `custom_fields` з кастомними полями:
  - `instagram-user-name` (API key кастомного поля)
  - `card_number` (номер картки лояльності)
  - `note` (нотатки)
- Інші додаткові поля

## Питання до підтримки

1. **Чи підтримується отримання `custom_fields` через API?**
   - Якщо так, який правильний endpoint та параметри?
   - Якщо ні, чи планується додати цю функціональність?

2. **Чи потрібні додаткові права доступу?**
   - Всі права на "Client Database" надані
   - USER_TOKEN згенерований після надання прав

3. **Як правильно отримати кастомні поля клієнта?**
   - Чи є окремий endpoint для custom_fields?
   - Чи потрібно використовувати інші параметри?

4. **Альтернативні підходи:**
   - Чи можна отримати custom_fields через вебхуки?
   - Чи є інший спосіб доступу до цих даних?

## Технічні деталі

- **Application ID:** 1203
- **Company ID (Location ID):** 1169323
- **Partner ID:** 784
- **API Version:** v1 (з заголовком `Accept: application/vnd.api.v2+json`)
- **Authorization:** `Bearer <partner_token>, User <user_token>`

## Приклад запиту

```bash
curl -X GET "https://api.alteg.io/api/v1/company/1169323/client/160692050?include[]=custom_fields" \
  -H "Accept: application/vnd.api.v2+json" \
  -H "Authorization: Bearer <partner_token>, User <user_token>"
```

**Очікувана відповідь:**
```json
{
  "id": 160692050,
  "name": "Марків Валерія",
  "phone": "+380955747853",
  "email": "",
  "custom_fields": {
    "instagram-user-name": "mv_valeria",
    "card_number": "mv_valeria",
    "note": "mv_valeria"
  }
}
```

**Фактична відповідь:**
```json
{
  "id": 160692050,
  "name": "Марків Валерія",
  "phone": "+380955747853",
  "email": "",
  "last_visit_date": "2025-11-26 18:00:00"
}
```

## Додаткова інформація

- Custom fields налаштовані в інтерфейсі Altegio
- API key для Instagram: `instagram-user-name`
- Всі права доступу надані
- USER_TOKEN згенерований після надання прав

---

**Дата:** 2025-01-26
**Контакт:** [ваш email]

