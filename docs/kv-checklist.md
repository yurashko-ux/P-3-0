# Швидка перевірка доступу до кампаній у KV

Ця пам'ятка зводить до кількох кроків усе, що треба зробити оператору, коли тестова сторінка ManyChat → KeyCRM не знаходить кампанії за V1/V2.

## 1. Перевірити, що REST-токен працює

```bash
curl -i \
  -H "Authorization: Bearer AVIxAAIncDEwMzc2NTgwYzgzOTc0NzUzYjIxMzY3Y2U2NzdkNjY1MXAxMjEwNDE" \
  "https://hot-louse-21041.upstash.io/ping"
```

Очікуваний результат — `HTTP/1.1 200 OK` і тіло `{"result":"PONG"}`. Це означає, що токен чинний і можна переходити до списку кампаній.

> Якщо працюєте з іншими реквізитами, підставте власні `KV_REST_API_URL` і `KV_REST_API_TOKEN`.

## 2. Переконатися, що індекс кампаній не порожній

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer AVIxAAIncDEwMzc2NTgwYzgzOTc0NzUzYjIxMzY3Y2U2NzdkNjY1MXAxMjEwNDE" \
  -H "Content-Type: application/json" \
  -d '["LRANGE","cmp:ids",0,-1]' \
  "https://hot-louse-21041.upstash.io"
```

- Масив на кшталт `["cmp:item:1759656242922", ...]` → індекс заповнений, можна читати конкретні кампанії.
- `[]` → індекс порожній; треба перевірити, чи синхронізація взагалі записує кампанії в KV.

## 3. Подивитися вміст конкретної кампанії

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer AVIxAAIncDEwMzc2NTgwYzgzOTc0NzUzYjIxMzY3Y2U2NzdkNjY1MXAxMjEwNDE" \
  -H "Content-Type: application/json" \
  -d '["GET","cmp:item:1759656242922"]' \
  "https://hot-louse-21041.upstash.io"
```

У відповіді має бути JSON із полями `"v1":"…"`, `"v2":"…"`, а також інформацією про воронки. Якщо значення відсутні або не ті, оновіть кампанію безпосередньо в KeyCRM.

## 4. Перевірити пошук через API застосунку

Якщо KV містить дані, але тестова сторінка все одно нічого не знаходить, зробіть запит до API застосунку (локально або на продакшені):

```bash
curl -fsS "http://localhost:3000/api/campaigns?value=1&slot=v1&match=equals"
```

Аналогічний запит для V2:

```bash
curl -fsS "http://localhost:3000/api/campaigns?value=2&slot=v2&match=equals"
```

У відповіді має бути масив кампаній і поле `ruleMatches`, яке покаже, яке правило спрацювало. Якщо масив порожній, проблема в логіці пошуку ManyChat → KeyCRM, а не в доступі до KV. Для швидкої перевірки без HTTP можна скористатися CLI-скриптом з кореня репозиторію:

```bash
npm run find:campaign -- --value 2 --slot v2 --match equals
```

---

Після проходження цих кроків ви точно знатимете, на якому етапі зникають дані: у KV їх немає, або пошук ManyChat подає інше значення. Усі деталі та розширені інструкції залишаються в [docs/campaign-kv-access.md](./campaign-kv-access.md).
