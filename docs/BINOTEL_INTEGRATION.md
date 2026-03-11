# План інтеграції Binotel

Документ описує інтеграцію з Binotel API для історії дзвінків та прослуховування записів у Direct Manager.

---

## Записи дзвінків (call records)

### Проблема

Binotel зберігає записи на S3 і повертає **presigned URL** з обмеженим терміном дії (~1 година). Без спеціальних параметрів API `stats/call-record` повертає **закешоване** посилання з моменту завершення дзвінка — для старих дзвінків воно вже протерміноване, відповідь S3: `403 AccessDenied — Request has expired`.

### Рішення

При запиті до `stats/call-record` **завжди передавати** параметри для отримання свіжого URL:

```typescript
// web/lib/binotel/call-record.ts
const res = await sendRequest("stats/call-record", {
  generalCallID: id,
  validity: 3600,   // секунди — термін дії нового URL
  expiresIn: 3600,
});
```

Це змушує Binotel генерувати новий presigned URL при кожному запиті, а не повертати старе закешоване посилання.

### Архітектура відтворення записів

1. Користувач натискає ▶ у колонці «Дзвінки»
2. `PlayRecordingButton` викликає проксі: `/api/admin/binotel/call-record-proxy?generalCallID=...`
3. Проксі викликає `getCallRecordUrl(generalCallID)` → Binotel `stats/call-record` з `validity`/`expiresIn`
4. Проксі завантажує MP3 з S3 Binotel і стримить клієнту (обхід CORS, браузер не звертається напряму до S3)

### Ключові файли

| Файл | Призначення |
|------|-------------|
| `web/lib/binotel/call-record.ts` | `getCallRecordUrl` — запит до Binotel з `validity`/`expiresIn` |
| `web/app/api/admin/binotel/call-record-proxy/route.ts` | Проксі: отримує URL → fetch з S3 → віддає blob |
| `web/app/admin/direct/_components/PlayRecordingButton.tsx` | Кнопка ▶, формує proxy URL |
| `web/app/admin/direct/_components/InlineCallRecordingPlayer.tsx` | Плеєр `<audio>` |

---

## Діагностика проблем

### 502 «Запис недоступний»

- Проксі повертає 502, коли S3 Binotel відповідає не 200.
- У логах Vercel шукати: `[call-record-proxy] S3 відповідь:` — там статус, `generalCallID`, превʼю body.

### 403 «Request has expired»

- Binotel повертає старе посилання — **перевірити**, що в `stats/call-record` передаються `validity` та `expiresIn`.
- Якщо їх прибрали чи змінили, відновити як у прикладі вище.

### CORS / SRC_NOT_SUPPORTED в браузері

- Браузер не повинен ходити напряму на S3 Binotel — лише на наш проксі.
- Переконатися, що `PlayRecordingButton` використовує `proxyUrl` з `generalCallID`, а не `recordingUrl` з БД (воно може бути застарілим).

---

## Інші частини інтеграції

- **Webhook** `POST /api/binotel/call-completed` — Binotel надсилає дані після завершення дзвінка
- **Sync** `lib/binotel/sync-calls.ts` — синхронізація історії з Binotel в `direct_client_binotel_calls`
- **ENV**: `BINOTEL_API_KEY`, `BINOTEL_API_SECRET`, `BINOTEL_TARGET_LINE`
