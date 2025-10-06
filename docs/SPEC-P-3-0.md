# SPEC-P-3-0 — ManiChat → KeyCRM

## Background

**Purpose.** Автоматично рухати картки в KeyCRM між воронками/статусами на основі подій/текстів, що надходять з ManiChat, за правилами «Кампаній». Надати просту адмінку для керування кампаніями, перегляду лічильників варіантів (V1/V2/EXP) та технічних утиліт.

**Why now.** Ручне переміщення карток займає час і призводить до помилок. Потрібен мінімальний, але надійний механізм правил/кампаній, який легко підтримувати та розширювати.

**Scope.**

* Інжест текстових подій з ManiChat → матч правил кампаній → переміщення картки в KeyCRM → інкремент лічильників.
* Адмінка: створення/редагування/видалення кампаній, перегляд лічильників, ручні інструменти (тест move).
* Зберігання у KV: індекс `campaigns:index` (ZSET), записи `campaigns:{id}` (JSON).

**Core domain terms.**

* **Condition**: `{ field: 'text' | 'any'; op: 'contains' | 'equals'; value: string }` (практично: `field='text'`).
* **Campaign**: базові поля + варіанти V1 (обов’язковий), V2 (опційний), EXP (експірація в днях у базовій воронці/статусі). Лічильники `v1_count`, `v2_count`, `exp_count`.

**Identifiers & lookup.**

* Instagram `username` з ManyChat трансформується у `contact.social_id` (з та без `@`) та `contact.full_name` при зверненнях до KeyCRM. Сам `username` як окремий ключ у KeyCRM **не** використовується.
* Під час інжесту (та у діагностичних інструментах) викликаємо helper `findCardSimple`, який спочатку шукає картку за `contact.social_id`, а якщо не знайдено — повторює спробу з `contact.full_name` / назвою картки.
* (Опційно, після MVP) кеш `social_id → card_id` у KV з TTL 24h для зменшення навантаження на KeyCRM.

**Integrations & endpoints (всередині проекту).**

* API адмінки:

  * `GET /api/campaigns` — список.
  * `POST /api/campaigns/create` — створення (повний payload форми) → `{ ok: true, id }`.
  * `DELETE /api/campaigns/[id]` — видалення.
* Довідники KeyCRM (проксі):

  * `GET /api/keycrm/pipelines`, `GET /api/keycrm/statuses?pipeline_id=...`.
  * `POST /api/keycrm/card/move` — тестове переміщення: `{ card_id, to_pipeline_id, to_status_id }`.
* Інжест ManiChat: `POST /api/mc/ingest` з `Authorization: Bearer ${MC_TOKEN}` або `?token=`. Body: `{ username, text }`.

**Security & config (Vercel ENV).**

* `ADMIN_PASS` (вхід в адмінку; cookie + localStorage).
* `KV_URL`, `KV_TOKEN` (KV storage); `KEYCRM_API_TOKEN`, `KEYCRM_BASE_URL` (доступ до KeyCRM).
* `MC_TOKEN` (інжест).

**State of play (на 2025-09-08).**

* Список кампаній: назви воронок/статусів показуються, лічильники видно, Delete працює.
* Створення: довідники з KeyCRM підтягування/валідація — ок; успіх збереження коректно визначається через `{ ok:true }` і `credentials:'include'`.
* Підключені маршрути `/api/keycrm/pipelines`, `/api/keycrm/statuses`; відмалювання назв в списку — ок.
* Відомі нюанси: повідомлення *“Lockdown failed: Cannot delete property 'dispose' ...”* не впливає на роботу API; `/admin/login` стабілізовано через `export const dynamic = 'force-dynamic'` та `revalidate = 0`.

**Immediate checks.**

1. У `web/app/api/campaigns/create/route.ts` виклики `kvSet` і `kvZAdd` (з великою A) мають існувати в `web/lib/kv.ts` (правильний експорт/реєстр).
2. `GET /api/campaigns` повертає нову кампанію одразу після створення.
3. Усі fetch з адмінки — з `credentials:'include'`.
4. Інжест читає `Authorization: Bearer ${MC_TOKEN}` або `?token=`.

### KeyCRM lookup diagnostics

*Покриває локальні/прод-перевірки пошуку карток за `contact.social_id` та `contact.full_name`.*

1. **Мок-тест без KeyCRM.**
   ```bash
   cd P-3-0/web
   npm install
   npm run test:keycrm:mock
   ```
   Скрипт `scripts/test-keycrm-mapping.ts` емулює відповіді KeyCRM і гарантує, що `findCardSimple` спершу знаходить картку за `social_id`, а потім за `full_name`.
2. **Живий запит через CLI.**
   ```bash
   cd P-3-0/web
   KEYCRM_API_TOKEN=<токен> npm run check:keycrm -- <instagram_handle>
   ```
   Опційно додайте `--social_name=instagram` або `--scope=global|campaign`. Скрипт послідовно робить дві спроби (social → full_name) і виводить, яка спрацювала.
3. **HTTP-ендпоінт (локально або на Vercel).**
   * Локально після `npm run dev`: `http://localhost:3000/api/keycrm/check?handle=<instagram_handle>`
   * Прод-URL після деплою: `https://p-3-0.vercel.app/api/keycrm/check?handle=<instagram_handle>`
   Ендпоінт повертає payload `requested` із фактичними ключами (`social_id`, `full_name`) та результат пошуку. Якщо отримуєте `404`, переконайтесь, що задеплоєна збірка містить маршрут `/api/keycrm/check`.

---

## Requirements

### Must‑have (M)

* (M) Інжест ManiChat: `POST /api/mc/ingest` з перевіркою токена (`Authorization: Bearer` або `?token=`), тіло `{ username, text }`.
* (M) Матчинг правил кампанії: нормалізований `text` (`lowercase`, `trim`, `NFKC`), операції `contains|equals`.
* (M) Рух картки: проксі `POST /api/keycrm/card/move` → переміщення в `to_pipeline_id/to_status_id`.
* (M) KV зберігання: `campaigns:{id}` JSON, індекс `campaigns:index` ZSET.
* (M) Адмінка: створення/видалення/list з лічильниками; усі `fetch` з `credentials:'include'`. Логін за `ADMIN_PASS` (cookie `admin_pass`).
* (M) Автоінкремент лічильників `v1_count|v2_count|exp_count` при діях.

### Should‑have (S)

* (S) Редагування кампанії `/admin/campaigns/[id]/edit`.
* (S) Е2Е лог мінімальний: `/admin/debug` з останніми N подіями (KV push‑list).

### Could‑have (C)

* (C) Кеш `username → card_id` у KV з TTL 24h.
* (C) Гідрація назв воронок/статусів у списку.

### Won’t‑have (W) у MVP

* (W) Авто‑створення картки, якщо не знайдено за `username`.
* (W) Складні DSL-правила поза `contains|equals`.

---

---

### 🔧 Quick patches — Step 1 (Storage + Create API)

> Мінімальні правки, щоб гарантовано працювало збереження кампанії та індексація в KV. Враховано `kvZAdd` з великою **A** та захист за `ADMIN_PASS`.

**`web/lib/kv.ts`**

```ts
// Upstash Redis via @upstash/redis
import { Redis } from "@upstash/redis";

const url = process.env.KV_URL!;
const token = process.env.KV_TOKEN!;
export const redis = new Redis({ url, token });

export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  return (await redis.get<T>(key)) ?? null;
}

export async function kvSet<T = unknown>(key: string, value: T): Promise<void> {
  await redis.set(key, value);
}

export async function kvDel(key: string): Promise<void> {
  await redis.del(key);
}

// NOTE: Capital A — kvZAdd
export async function kvZAdd(key: string, score: number, member: string): Promise<void> {
  await redis.zadd(key, { score, member });
}

export async function kvZRange(key: string, start = 0, stop = -1): Promise<string[]> {
  // returns members only (ids)
  return await redis.zrange<string[]>(key, start, stop);
}
```

**`web/app/api/campaigns/create/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { kvSet, kvZAdd } from "@/lib/kv"; // якщо немає alias '@/': замінити на "../../../lib/kv"

export const dynamic = "force-dynamic"; // без кешу
export const revalidate = 0;

// Типи для безпеки
type Condition = { field: "text" | "any"; op: "contains" | "equals"; value: string };
export type Campaign = {
  id: string; created_at: string;
  name: string;
  base_pipeline_id: string; base_status_id: string;
  v1_condition: Condition | null;
  v1_to_pipeline_id: string | null; v1_to_status_id: string | null;
  v2_condition: Condition | null;
  v2_to_pipeline_id: string | null; v2_to_status_id: string | null;
  exp_days: number; exp_to_pipeline_id: string | null; exp_to_status_id: string | null;
  enabled: boolean; v1_count: number; v2_count: number; exp_count: number;
  note?: string | null;
};

function uuid(): string {
  // працює і в edge, і в node
  // @ts-ignore
  return (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;
}

function normStr(s: unknown): string { return String(s ?? "").trim(); }

export async function POST(req: NextRequest) {
  const isAdmin = cookies().get("admin_pass")?.value === process.env.ADMIN_PASS;
  if (!isAdmin) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json();

  const v1_value = normStr(body.v1_value);
  if (!v1_value) return NextResponse.json({ ok: false, error: "v1_value required" }, { status: 400 });

  const id = uuid();
  const campaign: Campaign = {
    id,
    created_at: new Date().toISOString(),
    name: normStr(body.name),
    base_pipeline_id: normStr(body.base_pipeline_id),
    base_status_id: normStr(body.base_status_id),

    v1_condition: { field: "text", op: (body.v1_op === "equals" ? "equals" : "contains"), value: v1_value },
    v1_to_pipeline_id: normStr(body.v1_to_pipeline_id) || null,
    v1_to_status_id: normStr(body.v1_to_status_id) || null,

    v2_condition: (body.v2_enabled && normStr(body.v2_value))
      ? { field: "text", op: (body.v2_op === "equals" ? "equals" : "contains"), value: normStr(body.v2_value) }
      : null,
    v2_to_pipeline_id: normStr(body.v2_to_pipeline_id) || null,
    v2_to_status_id: normStr(body.v2_to_status_id) || null,

    exp_days: Number(body.exp_days ?? 0) || 0,
    exp_to_pipeline_id: normStr(body.exp_to_pipeline_id) || null,
    exp_to_status_id: normStr(body.exp_to_status_id) || null,

    enabled: Boolean(body.enabled),
    v1_count: 0, v2_count: 0, exp_count: 0,
    note: body.note ? String(body.note) : null,
  };

  // 1) запис кампанії 2) індекс для списку
  await kvSet(`campaigns:${id}`, campaign);
  await kvZAdd("campaigns:index", Date.now(), id);

  return NextResponse.json({ ok: true, id });
}
```

**Швидкий тест**

1. В адмінці увійти (щоб cookie `admin_pass` дорівнювало `ADMIN_PASS`).
2. Виконати `curl` зі створенням кампанії (з прикладу у брифі). Після 200/`{ ok:true }` — `GET /api/campaigns` повинен бачити запис одразу.\*

## Method

### Архітектура потоку інжесту

1. ManiChat викликає `POST /api/mc/ingest` з `{ username, text }` і токеном (Bearer або `?token=`).
2. API нормалізує текст та через helper `resolveCardByUsername(username)` отримує `card_id` (спершу KV‑кеш, інакше KeyCRM API).
3. Читаємо `campaigns:index` → вантажимо відповідні `campaigns:{id}` → фільтруємо `enabled` та (опційно) співпадіння базової пари `base_pipeline_id/base_status_id` з поточним станом картки.
4. Матчимо умови: спершу V2 (як більш специфічну), потім V1. Перша, що спрацювала, визначає переміщення.
5. Викликаємо `POST /api/keycrm/card/move` з `{ card_id, to_pipeline_id, to_status_id }`.
6. Інкрементуємо лічильник `v1_count` або `v2_count` у відповідній кампанії.

### Нормалізація та матчинг

* `normalize(s)`: NFKC, lower‑case, `trim`, стиснення повторних пробілів до одного.
* `equals`: повний збіг після нормалізації.
* `contains`: підрядок після нормалізації.
* Пріоритет: **V2 > V1**. Якщо жодна умова не збіглась — дія відсутня.

### Дані в KV

* `campaigns:index` — ZSET з `score = created_at (ms)`, `member = id`.
* `campaigns:{id}` — повний JSON кампанії.
* (Опційно) `map:ig:{username} -> card_id` з TTL 24 год.

### API узгодження

* Рух картки виконуємо виключно через внутрішній проксі `POST /api/keycrm/card/move`.
* Резолв картки по `username` — helper з KV‑кешем і викликом KeyCRM (конкретний метод пошуку залежить від вашого акаунта; помітимо як TODO у коді).

-

## Implementation

### 🔧 Quick patches — Step 2 (Ingest + List API)

**`web/app/api/campaigns/route.ts`** — лістинг (JSON) одразу після створення

```ts
import { NextResponse } from "next/server";
import { kvZRange, kvGet } from "@/lib/kv";
export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function GET() {
  const ids = await kvZRange("campaigns:index", 0, -1);
  const items = [] as any[];
  for (const id of ids) {
    const c = await kvGet<any>(`campaigns:${id}`);
    if (c) items.push(c);
  }
  // новіші згори
  items.sort((a,b)=> (a.created_at < b.created_at ? 1 : -1));
  return NextResponse.json(items);
}
```

**`web/app/api/mc/ingest/route.ts`** — інжест ManiChat

```ts
import { NextRequest, NextResponse } from "next/server";
import { kvGet, kvSet, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic"; export const revalidate = 0;

function ok(data: any = {}) { return NextResponse.json({ ok: true, ...data }); }
function bad(status: number, error: string) { return NextResponse.json({ ok:false, error }, { status }); }

function normalize(s: unknown): string {
  const t = String(s ?? "").toLowerCase().trim();
  return t;
}

function matchCond(text: string, cond: { op: "contains"|"equals"; value: string } | null): boolean {
  if (!cond) return false;
  const t = normalize(text), v = normalize(cond.value||"");
  if (!v) return false;
  return cond.op === "equals" ? (t === v) : t.includes(v);
}

async function incrementCounter(campaignId: string, field: "v1_count"|"v2_count"|"exp_count") {
  const key = `campaigns:${campaignId}`;
  const c = await kvGet<any>(key);
  if (!c) return;
  c[field] = (Number(c[field]||0) + 1);
  await kvSet(key, c);
}

async function resolveCardByUsername(username: string): Promise<string|null> {
  // TODO: виклик KeyCRM для пошуку картки за унікальним Instagram username.
  // 1) Можна додати KV‑кеш map:ig:{username} -> card_id з TTL.
  // 2) Якщо картку не знайдено — повертаємо null.
  return null;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const qp = url.searchParams.get("token");
  if ((bearer ?? qp) !== process.env.MC_TOKEN) return bad(401, "unauthorized");

  const body = await req.json().catch(()=>({}));
  const username = String(body.username||"").trim();
  const text = String(body.text||"");
  if (!username) return bad(400, "username required");

  const card_id = await resolveCardByUsername(username);
  if (!card_id) return ok({ applied: null, note: "card not found by username" });

  // 1) зчитати кампанії
  const ids = await kvZRange("campaigns:index", 0, -1);
  const campaigns = [] as any[];
  for (const id of ids) {
    const c = await kvGet<any>(`campaigns:${id}`);
    if (c?.enabled) campaigns.push(c);
  }

  // 2) визначити спрацювання (V2 має пріоритет)
  let chosen: { id: string; variant: "v1"|"v2"; to_pipeline_id: string|null; to_status_id: string|null } | null = null;
  for (const c of campaigns) {
    const v2hit = matchCond(text, c.v2_condition);
    const v1hit = !v2hit && matchCond(text, c.v1_condition);
    if (v2hit) chosen = { id: c.id, variant: "v2", to_pipeline_id: c.v2_to_pipeline_id, to_status_id: c.v2_to_status_id };
    else if (v1hit) chosen = { id: c.id, variant: "v1", to_pipeline_id: c.v1_to_pipeline_id, to_status_id: c.v1_to_status_id };
    if (chosen) break; // перша релевантна кампанія
  }

  if (!chosen) return ok({ applied: null });

  // 3) рух картки через внутрішній проксі (безпечніше і стабільніше)
  const resp = await fetch(`${url.origin}/api/keycrm/card/move`, {
    method: "POST", headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ card_id, to_pipeline_id: chosen.to_pipeline_id, to_status_id: chosen.to_status_id })
  });
  const move = await resp.json().catch(()=>({ ok:false }));
  if (!move?.ok) return bad(502, "keycrm move failed");

  await incrementCounter(chosen.id, chosen.variant === "v1" ? "v1_count" : "v2_count");
  return ok({ applied: chosen.variant, campaign_id: chosen.id });
}
```

**cURL тест (інжест):**

```bash
curl -s -X POST "${DEPLOY}/api/mc/ingest?token=${MC_TOKEN}" \
 -H 'Content-Type: application/json' \
 -d '{"username":"<ig_login>","text":"yes"}'
```

### 🔧 Quick patches — Step 3 (Resolve + EXP Cron)

**`web/app/api/keycrm/resolve/route.ts`** — проксі для пошуку картки за IG username

```ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const username = url.searchParams.get("username");
  if (!username) return NextResponse.json({ ok:false, error: "username required" }, { status: 400 });

  // TODO: виклик офіційного KeyCRM API.
  // Приклад (псевдо): const res = await fetch(`${process.env.KEYCRM_BASE_URL}/cards?ig_username=${encodeURIComponent(username)}`, { headers: { Authorization: `Bearer ${process.env.KEYCRM_API_TOKEN}` }});
  // const data = await res.json();
  // Повертаємо першу/активну картку або null

  return NextResponse.json({ ok:true, card_id: null });
}
```

**`web/app/api/cron/expire/route.ts`** — добовий крон для EXP (Vercel Cron)

```ts
import { NextResponse } from "next/server";
import { kvZRange, kvGet, kvSet } from "@/lib/kv";

export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function GET() {
  const ids = await kvZRange("campaigns:index", 0, -1);
  const now = Date.now();
  let moved = 0;

  for (const id of ids) {
    const c = await kvGet<any>(`campaigns:${id}`);
    if (!c?.enabled || !c.exp_days || !c.exp_to_pipeline_id || !c.exp_to_status_id) continue;
    // TODO: знайти всі картки в базовій воронці/статусі, що перебувають довше за exp_days
    // Псевдо: const cards = await keycrmFindStale(c.base_pipeline_id, c.base_status_id, c.exp_days)
    // for (const card of cards) { await moveCard(card.id, c.exp_to_pipeline_id, c.exp_to_status_id); c.exp_count++; moved++; }
    await kvSet(`campaigns:${id}`, c);
  }

  return NextResponse.json({ ok:true, moved });
}
```

**Vercel → Settings → Cron Jobs**

* `GET /api/cron/expire` раз/добу (наприклад `0 3 * * *`).

### 🔧 Quick patches — Step 2 (Ingest + List API)

**`web/app/api/campaigns/route.ts`** — лістинг (JSON) одразу після створення

```ts
import { NextResponse } from "next/server";
import { kvZRange, kvGet } from "@/lib/kv";
export const dynamic = "force-dynamic"; export const revalidate = 0;

export async function GET() {
  const ids = await kvZRange("campaigns:index", 0, -1);
  const items = [] as any[];
  for (const id of ids) {
    const c = await kvGet<any>(`campaigns:${id}`);
    if (c) items.push(c);
  }
  // новіші згори
  items.sort((a,b)=> (a.created_at < b.created_at ? 1 : -1));
  return NextResponse.json(items);
}
```

**`web/app/api/mc/ingest/route.ts`** — інжест ManiChat

```ts
import { NextRequest, NextResponse } from "next/server";
import { kvGet, kvSet, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic"; export const revalidate = 0;

function ok(data: any = {}) { return NextResponse.json({ ok: true, ...data }); }
function bad(status: number, error: string) { return NextResponse.json({ ok:false, error }, { status }); }

function normalize(s: unknown): string {
  const t = String(s ?? "").toLowerCase().trim();
  return t;
}

function matchCond(text: string, cond: { op: "contains"|"equals"; value: string } | null): boolean {
  if (!cond) return false;
  const t = normalize(text), v = normalize(cond.value||"");
  if (!v) return false;
  return cond.op === "equals" ? (t === v) : t.includes(v);
}

async function incrementCounter(campaignId: string, field: "v1_count"|"v2_count"|"exp_count") {
  const key = `campaigns:${campaignId}`;
  const c = await kvGet<any>(key);
  if (!c) return;
  c[field] = (Number(c[field]||0) + 1);
  await kvSet(key, c);
}

async function resolveCardByUsername(username: string): Promise<string|null> {
  // TODO: виклик KeyCRM для пошуку картки за унікальним Instagram username.
  // 1) Можна додати KV‑кеш map:ig:{username} -> card_id з TTL.
  // 2) Якщо картку не знайдено — повертаємо null.
  return null;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const qp = url.searchParams.get("token");
  if ((bearer ?? qp) !== process.env.MC_TOKEN) return bad(401, "unauthorized");

  const body = await req.json().catch(()=>({}));
  const username = String(body.username||"").trim();
  const text = String(body.text||"");
  if (!username) return bad(400, "username required");

  const card_id = await resolveCardByUsername(username);
  if (!card_id) return ok({ applied: null, note: "card not found by username" });

  // 1) зчитати кампанії
  const ids = await kvZRange("campaigns:index", 0, -1);
  const campaigns = [] as any[];
  for (const id of ids) {
    const c = await kvGet<any>(`campaigns:${id}`);
    if (c?.enabled) campaigns.push(c);
  }

  // 2) визначити спрацювання (V2 має пріоритет)
  let chosen: { id: string; variant: "v1"|"v2"; to_pipeline_id: string|null; to_status_id: string|null } | null = null;
  for (const c of campaigns) {
    const v2hit = matchCond(text, c.v2_condition);
    const v1hit = !v2hit && matchCond(text, c.v1_condition);
    if (v2hit) chosen = { id: c.id, variant: "v2", to_pipeline_id: c.v2_to_pipeline_id, to_status_id: c.v2_to_status_id };
    else if (v1hit) chosen = { id: c.id, variant: "v1", to_pipeline_id: c.v1_to_pipeline_id, to_status_id: c.v1_to_status_id };
    if (chosen) break; // перша релевантна кампанія
  }

  if (!chosen) return ok({ applied: null });

  // 3) рух картки через внутрішній проксі (безпечніше і стабільніше)
  const resp = await fetch(`${url.origin}/api/keycrm/card/move`, {
    method: "POST", headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ card_id, to_pipeline_id: chosen.to_pipeline_id, to_status_id: chosen.to_status_id })
  });
  const move = await resp.json().catch(()=>({ ok:false }));
  if (!move?.ok) return bad(502, "keycrm move failed");

  await incrementCounter(chosen.id, chosen.variant === "v1" ? "v1_count" : "v2_count");
  return ok({ applied: chosen.variant, campaign_id: chosen.id });
}
```

**cURL тест (інжест):**

```bash
curl -s -X POST "${DEPLOY}/api/mc/ingest?token=${MC_TOKEN}" \
 -H 'Content-Type: application/json' \
 -d '{"username":"<ig_login>","text":"yes"}'
```

> Примітка: реалізуйте `resolveCardByUsername` (або окремий `/api/keycrm/resolve?username=` проксі) під ваш акаунт KeyCRM; після цього е2е має спрацювати.

*

## Milestones

1. **Storage & Create** — kvZAdd(A), kvSet, `POST /api/campaigns/create`, список відразу бачить нові записи.
2. **Ingest MVP** — `POST /api/mc/ingest` з нормалізацією тексту, пріоритет V2→V1, інкремент лічильників, ручний `/api/keycrm/card/move` (проксі).
3. **Resolve by username** — `/api/keycrm/resolve` або вбудований helper + (опц.) KV‑кеш.
4. **Edit Campaign** — `/admin/campaigns/[id]/edit` (форма = створення, але з preload).
5. **EXP Cron** — `GET /api/cron/expire` + Vercel Cron, інкремент `exp_count`.
6. **Debug log** — `/admin/debug` останні N подій (KV list) + фільтр.
7. **Polish** — пороги ретраїв, обробка помилок KeyCRM, невеликі метрики.

*

## Gathering Results

**Functionality acceptance**

* Е2Е тест ManiChat → `/api/mc/ingest` → матч → move → лічильник +1 → видно в `/admin/campaigns` після Refresh.
* NEG‑кейси: невірний токен, порожній `username`, не знайдена картка — дія пропущена, лог створений.

**Observability**

* KV‑події (append‑list): `mc:ingest:*`, `keycrm:move:*`, `campaign:update:*`.
* Мінімальні метрики: кількість інжестів/хв, відсоток успішних move, топ‑кампанії по спрацюваннях.

**Performance**

* SLA інжесту: p95 < 500мс при кешованому резолві; < 1.5с при зверненні до KeyCRM.
* Обмежити N кампаній, що читаються за інжест (наприклад, перші 200 за індексом) — достатньо для MVP.

**Security**

* Перевірка токена (`MC_TOKEN`), CORS заборонено; адмінка — по cookie `admin_pass`.
* Секрети лише в ENV Vercel; регенерація ключів при витоках.

-

## Need Professional Help in Developing Your Architecture?

Будь ласка, зв’яжіться зі мною на [sammuti.com](https://sammuti.com) :)
