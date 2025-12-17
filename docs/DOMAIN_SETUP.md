# Налаштування домену hob.finance-report в Vercel

## Проблема: "Invalid Configuration"

Домен `hob.finance-report` показує "Invalid Configuration" тому, що nameservers не налаштовані на Vercel DNS.

## Як виправити

### Крок 1: Оновіть Nameservers у вашому реєстраторі домену

Домен `hob.finance-report` потребує зміни nameservers на Vercel DNS.

**Nameservers, які потрібно встановити:**
```
ns1.vercel-dns.com
ns2.vercel-dns.com
```

### Крок 2: Налаштування в реєстраторі домену

1. **Зайдіть в панель управління вашим реєстратором домену** (де ви купили домен `finance-report`)

2. **Знайдіть розділ "DNS Settings" або "Nameservers"**

3. **Змініть nameservers на:**
   - `ns1.vercel-dns.com`
   - `ns2.vercel-dns.com`

4. **Збережіть зміни**

### Крок 3: Очікуйте поширення змін

- Зміни nameservers можуть зайняти **від кількох хвилин до 24 годин**
- Зазвичай це відбувається протягом 1-2 годин

### Крок 4: Перевірте в Vercel

1. **Після зміни nameservers**, зайдіть в Vercel → **Settings → Domains**
2. **Натисніть "Refresh"** біля домену `hob.finance-report`
3. **Статус має змінитися** з "Invalid Configuration" на "Valid Configuration" (синя галочка ✓)

## Важливо

- ⚠️ **Після зміни nameservers на Vercel**, всі DNS записи будуть керуватися через Vercel
- Якщо у вас є інші піддомени або сервіси на цьому домені, їх потрібно буде налаштувати через Vercel DNS
- Зміна nameservers не впливає на сам домен, тільки на DNS управління

## Перевірка конфігурації

Після налаштування DNS:

1. **Закомітьте зміни в vercel.json:**
   ```bash
   git add vercel.json
   git commit -m "chore: add rewrites for hob.finance-report domain"
   git push origin main
   ```

2. **Перевірте в Vercel:**
   - Зайдіть в **Settings → Domains**
   - Статус має змінитися на "Valid Configuration" (синя галочка)

3. **Перевірте доступність:**
   - Відкрийте `https://hob.finance-report` (або `https://hob.finance-report.vercel.com`)
   - Має відкритися сторінка входу `/finance-report/login`

## Важливо

- Якщо домен `hob.finance-report` (без `.vercel.com`), потрібно налаштувати DNS у реєстраторі
- Якщо домен `hob.finance-report.vercel.com`, він має працювати автоматично
- Перевірте точну назву домену в Vercel → Settings → Domains
