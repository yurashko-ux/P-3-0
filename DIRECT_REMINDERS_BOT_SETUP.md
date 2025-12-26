# Налаштування бота для нагадувань Direct клієнтів

## Крок 1: Додати токен бота в Vercel Environment Variables

Додайте нову змінну середовища в Vercel:

```
TELEGRAM_DIRECT_REMINDERS_BOT_TOKEN=8392325399:AAG_Emwy1efFtDCIWlWLsydvCJBopztm3zA
```

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

- **Старий бот** (`TELEGRAM_BOT_TOKEN`) - використовується для фото-звітів
- **Новий бот** (`TELEGRAM_DIRECT_REMINDERS_BOT_TOKEN`) - використовується для нагадувань Direct клієнтів
- Якщо `TELEGRAM_DIRECT_REMINDERS_BOT_TOKEN` не встановлено, використовується `TELEGRAM_BOT_TOKEN` (fallback)

## Webhook endpoints

- `/api/telegram/webhook` - для старого бота (фото-звіти)
- `/api/telegram/direct-reminders-webhook` - для нового бота (нагадування Direct клієнтів)
