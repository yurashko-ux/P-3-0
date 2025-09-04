# Campaigns — ТЗ (Single Source of Truth)
Версія: 1.0

## 1) Огляд
Кампанія — набір правил автоматичного переміщення карток KeyCRM. Вона діє **лише** для карток, що зараз знаходяться в **базовій воронці + базовому статусі** (scope кампанії).

## 2) Сутності та поля

### Campaign
- `id` (uuid)
- `createdAt` (ISO)
- **Scope**:
  - `base_pipeline_id` (number), `base_pipeline_label` (string)
  - `base_status_id` (number), `base_status_label` (string)
- **Правила**:
  - `rule1?`: `{ value: string, to_pipeline_id: number, to_status_id: number, to_pipeline_label?: string, to_status_label?: string }`
  - `rule2?`: `{ ... як вище ... }`
- **Expire**:
  - `expire_days?` (number)
  - `expire_to?`: `{ to_pipeline_id: number, to_status_id: number, to_pipeline_label?: string, to_status_label?: string }`

> Для зворотної сумісності список може відображати старі поля `toPipelineId`, `toStatusId`, `expiresDays` тощо, але **джерелом правди** є структура вище.

## 3) Збереження
- Сховище: Vercel KV
- Ключ кошика: `"campaigns"`
- `POST /api/campaigns` → генерує `id`, додає `createdAt`, зберігає JSON в хеші `campaigns` під цим `id`.
- `GET /api/campaigns` → дістає всі значення з хеша `campaigns`, сортує за `createdAt` ↓, повертає `{ items }`.
- `DELETE /api/campaigns/[id]` → видаляє елемент з хеша.

## 4) Авторизація
- Усі `/api/*` приймають `Authorization: Basic <base64(login:pass)>`.
- UI зберігає `ADMIN_LOGIN` / `ADMIN_PASS` у `localStorage` і додає заголовок до кожного fetch.

## 5) UI /campaigns
- Верхній блок: **Логін/Пароль** + «Зберегти».
- Форма:
  - **Scope**: селекти «Базова воронка» + «Базовий статус».
  - **Правило 1**: `Змінна №1` + ціль (воронка/статус).
  - **Правило 2**: `Змінна №2` + ціль.
  - **Expire**: `Днів без відповіді` + ціль.
  - Кнопка «Зберегти кампанію».
- Список:
  - Колонки: Створено | **Умови** | Expires | Дії
  - Умови показує:  
    **[Base: <pipeline>/<status>] — 1: "<value>" → <pipeline>/<status>; 2: …; Expire <N>d → <pipeline>/<status>**.

## 6) Логіка застосування (runtime)
- Якщо картка **зараз** у `base_pipeline_id` + `base_status_id`, тоді:
  - якщо вхідна змінна == `rule1.value` → переводимо в `rule1.to_*`;
  - інакше якщо == `rule2.value` → `rule2.to_*`;
  - інакше якщо картка без відповіді `expire_days` → `expire_to`.
- Інакше кампанія **не застосовується** до картки.

## 7) Валідація
- Scope обов’язковий: `base_pipeline_id` + `base_status_id`.
- Мінімум одне з: `rule1`, `rule2`, `expire_days`/`expire_to`.
- Ціль кожного правила повинна містити і воронку, і статус.

## 8) Взаємодія з KeyCRM
- `GET /api/keycrm/pipelines`
- `GET /api/keycrm/pipelines/:pipelineId/statuses`

## 9) Прийняття робіт (Acceptance)
- Можу створити кампанію з валідним scope → бачу її в списку.
- Після збереження UI оновлює список без перезавантаження.
- Видалення працює (рядок зникає, KV чистий).
- API відхиляє тіло без обов’язкового scope (400).

## 10) Відкриті питання
- Максимальна кількість активних кампаній? (за замовчуванням — без ліміту)
- Дедуплікація за `value` в межах одного scope? (поки ні)
