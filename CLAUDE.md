# P-3-0 — інструкції для Claude

Проєкт також розробляється в Cursor. Єдине джерело правил — файли Cursor нижче; їх підключено сюди, щоб Claude дотримувався тих самих правил. Нові правила додавати у файли Cursor, а не дублювати тут.

@.cursorrules
@.cursor/rules/admin-tools-and-workflow.mdc
@.cursor/rules/db-query-budget.mdc
@.cursor/rules/direct-state-icons.mdc
@.cursor/rules/git-workflow.mdc

## Примітки для Claude
- **Важливіше за правило автокоміту з Cursor:** зміни робити локально й перевіряти на dev-сервері (`cd web && npm run dev -- -p 3000`, http://localhost:3000) у вбудованому браузері. Комітити й пушити лише тоді, коли користувач напише.
- Локальний dev-сервер працює з продакшн-БД і KV (`web/.env.local`) — обережно із записом даних і зайвими запитами.
- Код застосунку — у `web/` (Next.js, Prisma). Деплой: push у `main` → Vercel (https://p-3-0.vercel.app).
- Статус збірки перевіряти через `vercel` CLI (`vercel ls`, `vercel inspect --logs <url>`) або в дашборді https://vercel.com/mykolays-projects/p-3-0.
- Файли `web/scripts/tmp-*.ts` і `web/tsconfig.tsbuildinfo` не комітити без потреби.
