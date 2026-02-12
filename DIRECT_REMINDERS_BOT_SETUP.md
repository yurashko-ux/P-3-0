# Налаштування бота для нагадувань Direct клієнтів

## Бот: HOB_client_bot

## Крок 1: Додати токен бота в Vercel Environment Variables

Додайте нову змінну середовища в Vercel:

```
TELEGRAM_HOB_CLIENT_BOT_TOKEN=8392325399:AAG_Emwy1efFtDCIWlWLsydvCJBopztm3zA
```

**Примітка:** Назва змінної містить `HOB_CLIENT_BOT` для розрізнення від `TELEGRAM_BOT_TOKEN` (фото-бот).

## Крок 2: Налаштування Webhook для нового бота

Налаштуйте webhook для нового бота, вказавши URL:

```
https://your-domain.com/api/telegram/direct-reminders-webhook
```

Або через Telegram Bot API:

```bash
curl -X POST "https://api.telegram.org/bot8392325399:AAG_Emwy1efFtDCIWlWLsydvCJBopztm3zA/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/api/telegram/direct-reminders-webhook"
  }'
```

## Крок 3: Перевірка налаштування

Після деплою перевірте, що webhook працює:

```bash
curl "https://api.telegram.org/bot8392325399:AAG_Emwy1efFtDCIWlWLsydvCJBopztm3zA/getWebhookInfo"
```

## Як це працює

- **Фото-бот** (`TELEGRAM_BOT_TOKEN`) - використовується для фото-звітів
- **HOB_client_bot** (`TELEGRAM_HOB_CLIENT_BOT_TOKEN`) - використовується для нагадувань Direct клієнтів
- Якщо `TELEGRAM_HOB_CLIENT_BOT_TOKEN` не встановлено, використовується `TELEGRAM_BOT_TOKEN` (fallback)

## Webhook endpoints

- `/api/telegram/webhook` - для старого бота (фото-звіти)
- `/api/telegram/direct-reminders-webhook` - для нового бота (нагадування Direct клієнтів)

## Діагностика: бот не відповідає на повідомлення

**Симптом:** Бот надсилає "Відсутній Instagram username", але коли ви відповідаєте Instagram username — нічого не відбувається (немає підтвердження "✅ Instagram username оновлено!").

**Причина:** Webhook не налаштований. Telegram не знає, куди надсилати оновлення.

**Перевірка:**
```bash
curl "https://api.telegram.org/bot<TELEGRAM_HOB_CLIENT_BOT_TOKEN>/getWebhookInfo"
```

Якщо `"url":""` — webhook порожній, його потрібно встановити.

**Рішення — встановити webhook:**
```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_HOB_CLIENT_BOT_TOKEN>/setWebhook?url=https://p-3-0.vercel.app/api/telegram/direct-reminders-webhook"
```

Після успішного встановлення (`"ok":true,"description":"Webhook was set"`) бот почне отримувати повідомлення і коректно обробляти відповіді з Instagram username.
