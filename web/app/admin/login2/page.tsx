// web/app/admin/login2/page.tsx
'use client';

import { useEffect, useState } from 'react';

export default function AdminLogin2Page() {
  const [next, setNext] = useState('/admin/campaigns2');

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const n = sp.get('next');
      if (n) setNext(n);
    } catch {}
  }, []);

  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="rounded-2xl border p-6 bg-white">
        <h1 className="text-3xl font-semibold mb-6">Debug-логін (для campaigns2)</h1>
        {/* Чистий POST → сервер ставить куки і редіректить */}
        <form method="POST" action="/api/admin/login2" className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <label className="block">
            <div className="text-sm mb-2">ADMIN_PASS</div>
            <input
              name="pass"
              type="password"
              className="w-full rounded-2xl border px-4 py-3 bg-blue-50"
              placeholder="Введи ADMIN_PASS"
              autoFocus
              required
            />
          </label>

          <button type="submit" className="w-full rounded-2xl bg-blue-600 text-white py-3">
            Увійти
          </button>

          <p className="text-sm text-gray-600">
            Після входу повернемося на: <code>{next}</code>. Основний логін /admin/login — без змін.
          </p>
        </form>
      </div>
    </div>
  );
}
