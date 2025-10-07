# Локальний запуск та тести

## Встановлення залежностей

У репозиторії використовується npm workspace: основний `package.json` лежить у корені, а фронтенд — у каталозі `web/`. Щоб встановити залежності, виконайте у корені:

```bash
npm install
```

Ця команда підтягне пакети для всіх workspace-ів (зараз це лише `web`).

## Запуск lint / тестів

Команда `npm test` у корені делегує запуск `npm run lint` у workspace `web`. Таким чином:

```bash
npm test
```

еквівалентно виклику `npm run lint --workspace web`. Якщо потрібно запускати інші скрипти з `web/package.json`, можна скористатися синтаксисом:

```bash
npm run <script> --workspace web
```

Наприклад, `npm run dev --workspace web` для локального запуску Next.js.
