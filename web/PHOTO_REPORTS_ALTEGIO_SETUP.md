# Налаштування інтеграції фото-звітів з Altegio

Цей документ описує, як налаштувати автоматичні нагадування про фото-звіти на основі реальних подій з календаря Altegio.

## Як це працює

1. **Крон-джоб** `/api/cron/photo-reminders` запускається регулярно (наприклад, кожні 5-10 хвилин)
2. Отримує **appointments** з Altegio API, які закінчуються в найближчому часі (за замовчуванням - наступні 20 хвилин)
3. Для кожного appointment:
   - Перевіряє, чи вже є фото-звіт
   - Знаходить майстра за `staff_id` з Altegio
   - Знаходить `chatId` майстра в Telegram
   - Відправляє нагадування через Telegram бота

## Крок 1: Налаштування маппінгу майстрів

Потрібно додати `altegioStaffId` для кожного майстра в `web/lib/photo-reports/mock-data.ts`:

```typescript
export const MOCK_MASTERS: MasterProfile[] = [
  {
    id: "master-olena",
    name: "Олена",
    telegramUsername: "o_sarbeeva",
    role: "master",
    altegioStaffId: 123, // ← Додайте реальний staff_id з Altegio
  },
  // ...
];
```

### Як знайти staff_id в Altegio:

1. Відкрийте Altegio → Налаштування → Співробітники
2. Відкрийте профіль майстра
3. В URL або в API відповіді буде `staff_id` (наприклад, `123`)
4. Додайте цей ID в `altegioStaffId` для відповідного майстра

Або використайте тестовий endpoint для отримання списку майстрів:
```
GET /api/altegio/test/appointments/full-week
```

## Крок 2: Налаштування ENV змінних

Переконайтеся, що встановлені наступні змінні:

```env
# Altegio API
ALTEGIO_USER_TOKEN=your_user_token
ALTEGIO_PARTNER_ID=your_company_id  # ID вашої філії/салону
ALTEGIO_API_URL=https://api.alteg.io/api/v1

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_PHOTO_GROUP_ID=your_group_id  # ID групи для фото-звітів
TELEGRAM_ADMIN_CHAT_IDS=123456789,987654321  # ID адмінів (через кому)

# Cron (опціонально, для ручного виклику)
CRON_SECRET=your_secret_key
```

## Крок 3: Реєстрація майстрів в Telegram

Кожен майстер повинен:
1. Знайти вашого Telegram бота
2. Надіслати команду `/start`
3. Бот автоматично зареєструє їх за `telegramUsername` або ім'ям

## Крок 4: Налаштування Vercel Cron

Додайте в `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/photo-reminders",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Або через Vercel Dashboard:
1. Settings → Cron Jobs
2. Додайте новий cron: `GET /api/cron/photo-reminders`
3. Schedule: `*/5 * * * *` (кожні 5 хвилин)

## Крок 5: Тестування

### Ручний виклик (з секретом):

```bash
curl -X POST "https://your-domain.com/api/cron/photo-reminders?secret=your_secret&minutesAhead=20"
```

### Перевірка логів:

Подивіться логи в Vercel Dashboard або через:
```bash
vercel logs --follow
```

## Структура даних

### Appointment з Altegio → AppointmentReminder

Крон-джоб автоматично конвертує дані:

- `appointment.id` → `reminder.id` (з префіксом `altegio-`)
- `appointment.client.name` → `reminder.clientName`
- `appointment.service.title` → `reminder.serviceName`
- `appointment.staff_id` → знаходить майстра → `reminder.masterId`
- `appointment.end_datetime` → `reminder.endAt`

## Troubleshooting

### "Master not found for staff_id X"

- Перевірте, чи додали `altegioStaffId` для майстра в `mock-data.ts`
- Перевірте, чи `staff_id` з Altegio співпадає з `altegioStaffId`

### "Chat not registered for master"

- Майстер повинен надіслати `/start` боту в Telegram
- Перевірте, чи `telegramUsername` в `mock-data.ts` співпадає з реальним username

### "Appointment missing end_datetime"

- Перевірте, чи Altegio API повертає `end_datetime` або `datetime`
- Можливо, потрібно використати `start_datetime + duration`

### "No appointments found"

- Перевірте `ALTEGIO_PARTNER_ID` (має бути ID філії/салону)
- Перевірте, чи є активні appointments в Altegio на найближчі 20 хвилин
- Перевірте права доступу токена

## Додаткові налаштування

### Зміна часового вікна нагадувань

За замовчуванням нагадування відправляються за 20 хвилин до закінчення. Щоб змінити:

```bash
# Через query параметр
GET /api/cron/photo-reminders?minutesAhead=15

# Або в body
POST /api/cron/photo-reminders
{
  "minutesAhead": 15
}
```

### Фільтрація за компанією

Якщо у вас кілька філій:

```bash
GET /api/cron/photo-reminders?company_id=123456
```

## Приклад відповіді API

```json
{
  "ok": true,
  "timestamp": "2025-01-15T10:30:00.000Z",
  "companyId": 123456,
  "minutesAhead": 20,
  "summary": {
    "processed": 5,
    "sent": 3,
    "skipped": 2,
    "errors": []
  }
}
```

