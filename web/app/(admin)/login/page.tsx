// web/app/(admin)/login/page.tsx
'use client';

import { useState } from 'react';

export default function AdminLoginPage() {
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // IMPORTANT:
  // ця форма НЕ робить fetch на бекенд.
  // Вона просто переспрямовує на /admin?token=...,
  // а middleware вже поставить кукі 'admin_token' і впустить.
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const token = (pwd || '').trim();

    if (!token) {
      setErr('Введи пароль');
      return;
    }

    try {
      setBusy(true);
      // Редірект на захищений роут з токеном у query
      window.location.href = `/admin?token=${encodeURIComponent(token)}`;
    } finally {
      // нічого — редірект забере сторінку
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl shadow p-6 bg-white">
        <h1 className="text-xl font-semibold mb-4 text-center">Admin Login</h1>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Пароль</label>
            <input
              type="password"
              autoFocus
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 outline-none focus:ring"
              placeholder="Введи адмін-пароль"
            />
          </div>

          {err && (
            <p className="text-sm text-red-600">{err}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl px-4 py-2 border bg-black text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? 'Входимо…' : 'Увійти'}
          </button>
        </form>

        <p className="text-xs text-gray-500 mt-4 text-center">
          Після успішного логіну буде редірект на <code>/admin</code> і кукі <code>admin_token</code> встановить middleware.
        </p>
      </div>
    </main>
  );
}
