# Налаштування окремого домену для Фінансового звіту

## Що вже зроблено

✅ Окреме логування для розділу "Фінансовий звіт"  
✅ Сторінка входу: `/finance-report/login`  
✅ Захищений розділ: `/admin/finance-report`  
✅ Налаштовано rewrites в `vercel.json` для окремого домену

## Як підключити безкоштовний домен на Vercel

### 1. Додай домен в Vercel

1. Зайди в Vercel → проект `P-3-0`
2. Перейди в **Settings → Domains**
3. Натисни **Add** і введи:
   - Або свій сабдомен: `fin.yourdomain.com`
   - Або новий Vercel домен: `finance-report-xxx.vercel.app`

### 2. Онови `vercel.json`

Після додавання домену, заміни `finance-report.example.com` на **точну назву твого домену**:

```json
{
  "rewrites": [
    {
      "source": "/",
      "has": [
        {
          "type": "host",
          "value": "ТВІЙ_ДОМЕН_ТУТ"  // ← заміни на свій домен
        }
      ],
      "destination": "/finance-report/login"
    },
    {
      "source": "/admin",
      "has": [
        {
          "type": "host",
          "value": "ТВІЙ_ДОМЕН_ТУТ"  // ← заміни на свій домен
        }
      ],
      "destination": "/admin/finance-report"
    }
  ]
}
```

### 3. Встанови змінну середовища

У Vercel → Settings → Environment Variables додай:

- **Key**: `FINANCE_REPORT_PASS`
- **Value**: твій пароль для фінзвіту

### 4. Закоміть і запуш зміни

```bash
git add vercel.json
git commit -m "chore: update finance-report domain"
git push origin feature/altegio-integration
```

## Як це працює

- **`https://ТВІЙ_ФІН_ДОМЕН/`** → відкриває сторінку входу `/finance-report/login`
- **`https://ТВІЙ_ФІН_ДОМЕН/admin`** → після логіну веде в `/admin/finance-report`
- **Logout**: `/admin/finance-report/logout` → очищає сесію і повертає на логін

## Доступ

- **Окремий пароль**: використовуй `FINANCE_REPORT_PASS` для входу через `/finance-report/login`
- **Адмін-доступ**: якщо вже залогінений як адмін (кука `admin_token`), доступ до фінзвіту є автоматично

## Безпека

- Токен зберігається в куці `finance_report_token` на 30 днів
- Кука встановлюється з `secure: true` (тільки HTTPS)
- Окрема авторизація не впливає на основну адмінку
