# Запит до техпідтримки Alteg.io API

## Проблема

Отримую помилку `401 Unauthorized: {"success":false,"data":null,"meta":{"message":"Partner ID not specified"}}` при спробі підключення до API для непублічної програми.

## Контекст

- **Тип програми**: Непублічна програма (не для маркетплейсу)
- **Application ID**: 1193
- **User Token**: Отримано в розділі "Доступ до API" маркетплейсу
- **Salon ID (ID філії)**: 1169323

## Налаштування Environment Variables

```
ALTEGIO_API_URL = https://api.alteg.io/api/v1
ALTEGIO_USER_TOKEN = f754b6943b6a23de9297a9abeceefc87
ALTEGIO_APPLICATION_ID = 1193
ALTEGIO_PARTNER_ID = 1169323
```

## Спробовані формати Authorization header

### 1. Формат з User Token та Partner ID (ID філії)
```
Authorization: Bearer f754b6943b6a23de9297a9abeceefc87, Partner 1169323
```

### 2. Формат як для публічних програм
```
Authorization: Bearer 1193, User f754b6943b6a23de9297a9abeceefc87
```

### 3. Тільки User Token
```
Authorization: Bearer f754b6943b6a23de9297a9abeceefc87
```

## Додаткові заголовки, які ми пробували передавати

- `X-Partner-ID: 1169323`
- `Partner-ID: 1169323`
- `X-Partner-Id: 1169323`
- `X-PartnerId: 1169323`

## Query параметри, які ми пробували передавати

- `?partner_id=1169323`
- `?partner_id=1193`
- `?application_id=1193`

## Endpoint, який викликаємо

```
GET https://api.alteg.io/api/v1/companies
```

## Питання

1. Який формат Authorization header правильний для непублічної програми?
2. Чи потрібен Partner ID для непублічної програми? Якщо так, який саме:
   - Application ID (1193)?
   - Salon ID / ID філії (1169323)?
   - Щось інше?
3. Де саме повинен передаватися Partner ID:
   - В Authorization header?
   - В окремих заголовках (які саме)?
   - В query параметрах (який саме параметр)?
4. Чи достатньо тільки User Token для непублічної програми, або обов'язково потрібен Partner ID?

## Приклади запитів, які ми робили

### Запит 1: User Token + Partner ID (ID філії) в Authorization header
```http
GET /api/v1/companies?partner_id=1169323 HTTP/1.1
Host: api.alteg.io
Authorization: Bearer f754b6943b6a23de9297a9abeceefc87, Partner 1169323
X-Partner-ID: 1169323
Partner-ID: 1169323
Accept: application/json
Content-Type: application/json
```

**Відповідь**: `401 Unauthorized: Partner ID not specified`

### Запит 2: Формат як для публічних програм (Application ID як Partner Token)
```http
GET /api/v1/companies?partner_id=1193 HTTP/1.1
Host: api.alteg.io
Authorization: Bearer 1193, User f754b6943b6a23de9297a9abeceefc87
X-Partner-ID: 1193
Accept: application/json
Content-Type: application/json
```

**Відповідь**: (ще не тестували після останніх змін)

### Запит 3: Тільки User Token
```http
GET /api/v1/companies HTTP/1.1
Host: api.alteg.io
Authorization: Bearer f754b6943b6a23de9297a9abeceefc87
Accept: application/json
Content-Type: application/json
```

**Відповідь**: `401 Unauthorized: Partner ID not specified`

## Додаткова інформація

- Webhook URL налаштовано в маркетплейсі: `https://our-domain.vercel.app/api/altegio/webhook`
- User Token отримано в розділі "Доступ до API" маркетплейсу Alteg.io
- Права доступу налаштовані для User Token

## Очікувана поведінка

Очікую, що з правильним форматом Authorization header та Partner ID API повинен повернути список компаній (салонів) для даної філії.

---

**Дата**: 2025-11-22  
**Application ID**: 1193  
**Salon ID**: 1169323

