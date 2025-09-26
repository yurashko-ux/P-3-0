// web/app/(admin)/login/page.tsx
'use client';

import { useState } from 'react';

export default function AdminLoginPage() {
  const [value, setValue] = useState('');

  function setCookie(name: string, val: string, days = 30) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(val)}; path=/; SameSite=Lax; max-age=${days * 24 * 60 * 60}`;
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const token = value.trim();
    if (!token) return;

    // ставимо основний cookie, який перевіряє middleware
    setCookie('admin_token', token);
    // сумісність зі старими перевірками
    setCookie('admin', token);
    setCookie('admin_pass', token);

    // редирект в адмінку
    window.location.href = '/admin';
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-2xl border border-gray-200 p-8 shadow-sm bg-white">
        <h1 className="text-4xl font-bold tracking-tight mb-8">Логін адміна</h1>

        <form onSubmit={onSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">ADMIN_PASS</label>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Введи ADMIN_PASS"
              className="w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 py-4 text-lg outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xl font-semibold py-4 transition-colors"
          >
            Зайти
          </button>

          <p className="text-gray-600">
            Ставимо куки <code>admin_token</code>, <code>admin_pass</code> і <code>admin</code> (сумісність). Після логіну
            повернемося на: <code>/admin</code>
          </p>
        </form>
      </div>
    </div>
  );
}
