# Altegio integration – робочий контекст

- Поточна робоча гілка: `feature/altegio-integration`
- Admin UI: `web/app/(admin)/admin/altegio/page.tsx`
  - Є секція "Календар записів" з двома кнопками:
    - синя: викликає `/api/altegio/test/appointments?days=30`
    - жовта: викликає `/api/altegio/test/appointments/full-week`
  - Під секцією виводиться результат синьої кнопки через `appointmentsTestStatus`.
  - Після останніх змін доданий другий блок, який відображає `fullWeekAppointmentsStatus` (успіх/помилка, текст повідомлення).

- Backend:
  - `web/app/api/altegio/test/appointments/route.ts`:
    - використовує `getUpcomingAppointments` для наступних 30 днів;
    - повертає кількість записів, кількість записів із Instagram, приклади структур.
  - `web/app/api/altegio/test/appointments/full-week/route.ts`:
    - (наразі файл відсутній / був видалений; у фронтенді жовта кнопка вже є, але endpoint потрібно відновити);
    - бажаний інтервал: **7 днів назад + 7 днів вперед** з include клієнта/послуги/майстра.

- Статус кнопок:
  - Синя кнопка: часто повертає `Altegio 404 Not Found: {"success":false,"data":null,"meta":{"message":"An error has occurred"}}` – це відповідь Altegio.
  - Жовта кнопка: зараз показує `No appointments or visits found` (тобто endpoint працює, але знаходить 0 записів; інтервал треба розширити або точніше налаштувати).

- Ключова проблема:
  - Altegio API непослідовно поводиться для `/appointments` і можливих `/visits` endpoint’ів.
  - Необхідно:
    1. Відновити `full-week/route.ts` (GET), який:
       - читає `ALTEGIO_COMPANY_ID`;
       - бере інтервал `now-7d` … `now+7d` (YYYY-MM-DD);
       - робить GET `/company/{company_id}/appointments` з `include[]=client,service,staff`;
       - нормалізує відповідь у масив `appointments`.
    2. Перевірити, чи повертаються записи в цьому інтервалі (порівняти з календарем у UI Altegio).

- Telegram/фото-звіти вже працюють і не залежать від цього коду Altegio.

> Цей файл – короткий конспект для наступної сесії асистента, щоб не втрачати контекст по інтеграції Altegio.
