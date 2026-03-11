# Інтеграція Binotel — інструкція для розробників

> 📄 Повний план: [docs/BINOTEL_INTEGRATION.md](../../../docs/BINOTEL_INTEGRATION.md)

## Огляд

Інтеграція з Binotel API для:
- отримання історії дзвінків
- прослуховування записів у Direct Manager
- зіставлення дзвінків з клієнтами (за телефоном)

---

## Структура модуля

```
web/lib/binotel/
├── README.md          ← ви тут
├── client.ts          # Клієнт API (sendRequest, key/secret)
├── call-record.ts     # stats/call-record → URL запису (важливо: validity/expiresIn!)
├── fetch-calls.ts     # stats/incoming-calls-for-period, stats/outgoing-calls-for-period
├── sync-calls.ts      # Синхронізація в direct_client_binotel_calls
└── normalize-phone.ts # Нормалізація номерів для зіставлення
```

---

## Потік даних

```
Binotel API
    │
    ├─► Webhook: POST /api/binotel/call-completed
    │       └─► direct_client_binotel_calls (новий дзвінок)
    │
    ├─► Sync (cron): /api/admin/binotel/sync-calls
    │       └─► fetch-calls → sync-calls → direct_client_binotel_calls
    │
    └─► Відтворення запису:
            Клік ▶ → call-record-proxy?generalCallID=X
                 → getCallRecordUrl(X) [stats/call-record + validity/expiresIn]
                 → fetch MP3 з S3 → stream клієнту
```

---

## Записи дзвінків (КРИТИЧНО)

### Проблема
Binotel повертає presigned S3 URL з TTL ~1 год. Без параметрів `validity`/`expiresIn` API повертає **закешоване** посилання з моменту дзвінка → для старих дзвінків → 403 Request has expired.

### Рішення
У `call-record.ts` при запиті до `stats/call-record` **завжди** передавати:

```typescript
validity: 3600,
expiresIn: 3600,
```

Не прибирати ці параметри — без них записи не відтворюються для дзвінків старших ~1 год.

---

## Endpoint'и

| Endpoint | Призначення |
|----------|-------------|
| `POST /api/binotel/call-completed` | Webhook Binotel (PUSH після дзвінка) |
| `GET /api/admin/binotel/call-record-proxy?generalCallID=X` | Проксі для MP3 — обхід CORS, свіжий URL |
| `GET /api/admin/direct/clients/[id]/binotel-calls` | Історія дзвінків клієнта |
| `POST /api/admin/binotel/sync-calls` | Ручна синхронізація за період |

---

## ENV

```
BINOTEL_API_KEY=...
BINOTEL_API_SECRET=...
BINOTEL_TARGET_LINE=0930007800   # фільтр: лише дзвінки по цій лінії
```

---

## Швидка діагностика при поломках

| Симптом | Що перевірити |
|---------|---------------|
| 502 «Запис недоступний» | Vercel логи: `[call-record-proxy] S3 відповідь:` — статус, body |
| 403 Request has expired | Чи є `validity` та `expiresIn` у `call-record.ts` |
| CORS / SRC_NOT_SUPPORTED | PlayRecordingButton має використовувати proxy URL (generalCallID), не recordingUrl |
| Дзвінки не зʼявляються | Webhook URL у Binotel, BINOTEL_TARGET_LINE, sync cron |
| Запис не відтворюється | generalCallID передається? disposition ANSWER/VM-SUCCESS/SUCCESS? |
