image.png# Запит до техпідтримки Alteg.io API

## Проблема

Отримую помилку `403 Forbidden: {"success":false,"data":null,"meta":{"message":"No company management rights"}}` при спробі отримати клієнтів або записи через API для непублічної програми.

**Статус авторизації**: ✅ Вирішено (Partner ID issue)
**Поточна проблема**: ❌ Немає прав доступу до клієнтів та записів

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
- **Права доступу налаштовані для User Token в інтерфейсі Altegio (всі права включені)**
- ✅ **GET /companies** - працює (отримуємо компанію 1169323)
- ❌ **POST /company/1169323/clients** - 403 Forbidden: No company management rights
- ❌ **GET /company/1169323/appointments** - 403 Forbidden: No company management rights

## Поточна проблема

Після того, як ми вирішили проблему з Partner ID, API почав повертати `401 Unauthorized: Partner ID not specified` → `403 Forbidden: No company management rights`.

**Що працює:**
- ✅ Отримання інформації про компанію (`GET /companies`)
- ✅ Авторизація (Authorization header приймається)

**Що НЕ працює:**
- ❌ Отримання списку клієнтів (`POST /company/1169323/clients` або `GET /company/1169323/clients`)
- ❌ Отримання записів (`GET /company/1169323/appointments`)

**Спробовані методи отримання клієнтів:**
1. `GET /company/1169323/clients` → `405 Method Not Allowed`
2. `POST /company/1169323/clients` → `403 Forbidden: No company management rights`
3. `POST /clients` з `company_id: 1169323` в body → `403 Forbidden: No company management rights`
4. `GET /clients?company_id=1169323` → `404 Not Found`

**Спробовані методи отримання записів:**
1. `GET /company/1169323/appointments` → `403 Forbidden: No company management rights`

## Питання до підтримки

1. Чому API повертає `403 Forbidden: No company management rights`, якщо всі права включені в інтерфейсі Altegio для User Token?
2. Чи потрібні додаткові налаштування для непублічних програм?
3. Які саме права мають бути включені для доступу до клієнтів та записів?
4. Чи може бути проблема в тому, що User Token було створено до включення прав, і потрібен новий токен?
5. Який правильний endpoint та метод HTTP для отримання клієнтів компанії?

## Очікувана поведінка

Очікую, що з правильним форматом Authorization header та налаштованими правами API повинен:
- ✅ Отримати список клієнтів компанії (`/company/1169323/clients`)
- ✅ Отримати список записів компанії (`/company/1169323/appointments`)
- ✅ Отримати інформацію про клієнта разом з кастомними полями (зокрема, Instagram username)

---

**Дата**: 2025-11-22  
**Application ID**: 1193  
**Salon ID**: 1169323

