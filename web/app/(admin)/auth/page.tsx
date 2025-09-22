// web/app/(admin)/auth/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function setCookie(name: string, value: string, days = 30) {
  if (typeof document === 'undefined') return;
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = 'expires=' + d.toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; ${expires}; path=/; SameSite=Lax`;
}

export default function AdminAuthPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const redirectTo = search.get('to') || '/admin/campaigns';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const has =
      document.cookie.includes('admin_pass=') ||
      document.cookie.includes('admin_token=');
    if (has) router.replace(redirectTo);
  }, [router, redirectTo]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = value.trim();
    if (!token) return;
    setCookie('admin_pass', token);
    setCookie('admin_token', token);
    router.replace(redirectTo);
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border p-6 shadow-sm"
      >
        <h1 className="text-2xl font-semibold mb-4">Адмін доступ</h1>
        <p className="text-sm text-gray-500 mb-6">
          Введи значення змінної <code>ADMIN_PASS</code> (або <code>ADMIN_TOKEN</code>),
          ми збережемо його в cookies для доступу до адмін-ендпойнтів.
        </p>
        <label className="block text-sm font-medium mb-2">Адмін токен</label>
        <div className="flex items-center gap-2 mb-4">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Встав сюди токен…"
            className="flex-1 rounded-md border px-3 py-2 outline-none"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="rounded-md border px-3 py-2"
            aria-label="toggle-visibility"
          >
            {show ? 'Сховати' : 'Показати'}
          </button>
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Увійти
        </button>

        <p className="text-xs text-gray-500 mt-4">
          Після успіху перенаправимо на <code>{redirectTo}</code>.
        </p>
      </form>
    </div>
  );
}
