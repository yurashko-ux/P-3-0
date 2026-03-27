#!/usr/bin/env node
/**
 * Одноразовий виклик POST /api/admin/direct/sync-paid-service-dates на проді.
 * Потрібен CRON_SECRET з Vercel (той самий, що для cron).
 *
 * Запуск з кореня web:
 *   CRON_SECRET='...' npm run sync-paid-dates:prod
 */
const BASE = process.env.SYNC_PAID_DATES_URL || 'https://p-3-0.vercel.app';
const secret = process.env.CRON_SECRET;
if (!secret || !String(secret).trim()) {
  console.error(
    '[sync-paid-service-dates-prod] Встановіть CRON_SECRET (з Vercel → Settings → Environment Variables).'
  );
  process.exit(1);
}

const url = `${BASE.replace(/\/$/, '')}/api/admin/direct/sync-paid-service-dates`;

async function main() {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  console.log(JSON.stringify({ httpStatus: res.status, body }, null, 2));
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
