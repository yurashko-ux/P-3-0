# Банк: налаштування бази даних

## Проблема: підключення зникають після повторного логіну

Якщо після «Підключити» дані з’являються, а після перезаходу в адмінку знову «Немає підключень», найчастіше це через **дві різні бази** або **read replica**.

У проєкті використовуються змінні:

- **PRISMA_DATABASE_URL** — використовується Prisma (схема та runtime).
- **DATABASE_URL** — fallback у `lib/prisma.ts`, якщо немає PRISMA_DATABASE_URL.

## Що зробити у Vercel (Environment Variables)

1. **Одна база для всього**  
   У Production (і за бажанням Preview) мають вказувати на **ту саму** базу:
   - **PRISMA_DATABASE_URL** = рядок підключення до **основної (primary)** бази.
   - **DATABASE_URL** = **той самий** рядок, що й PRISMA_DATABASE_URL.

2. **Не використовувати read replica для основних запитів**  
   Якщо в URL вказано read replica або окремий read-only інстанс, записи будуть у primary, а читання — з репліки; репліка може відставати, тому GET часто повертає порожній список. Для Production обидві змінні мають вести на **primary** (записуючий) інстанс.

3. **Перевірка в логах**  
   Після деплою в логах Vercel з’являється рядок на кшталт:
   `[bank/monobank/connect] success ... | total in DB: N`  
   та  
   `[bank/connections] returning count: N`  
   Якщо після успішного connect у GET все одно `returning count: 0`, запити йдуть у різні інстанси або різні бази — потрібно вирівняти PRISMA_DATABASE_URL і DATABASE_URL на одну primary-базу.

## Якщо в логах один і той самий хост (наприклад accelerate.prisma-data.net), але GET повертає 0

Це типова ситуація для **Prisma Accelerate**: запис йде в primary, а читання — на репліку або з кешу, тому одразу після connect GET може повертати порожній список.

**Що зробити:** використовувати **direct** (прямий) рядок підключення до Postgres, а не URL через Accelerate.

- У **Prisma Data Platform** (де створювали базу) є два типи URL: через Accelerate (`accelerate.prisma-data.net`) і **direct** до бази. Для Production у Vercel встановіть у PRISMA_DATABASE_URL і DATABASE_URL саме **direct** URL (postgresql://... до вашого кластера), щоб усі запити йшли в один primary і не було затримки репліки.
- Якщо база на **Neon**, у Dashboard можна взяти "Direct connection" (не pooled через Accelerate) і підставити його в обидві змінні.

Після зміни URL на direct — передеплойте; підключення банку мають зберігатися після перезаходу.

## Підсумок

- Поставте **PRISMA_DATABASE_URL** і **DATABASE_URL** на **одне й те саме** підключення до primary-бази.
- Якщо зараз використовується URL через **Accelerate** (`accelerate.prisma-data.net`) і GET повертає 0 при тих самих логах — замініть обидві змінні на **direct** URL до Postgres.
- Передеплойте проект і ще раз перевірте підключення та повторний логін.
