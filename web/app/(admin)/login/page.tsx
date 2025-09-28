// web/app/(admin)/login/page.tsx
'use client';

import * as React from 'react';

export default function AdminLoginPage() {
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  // Автологін по ?token=... (не використовуємо useSearchParams, щоб не було проблем зі Suspense)
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      // при автологіні пробуємо раз і показуємо статус
      void doLogin(token, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doLogin(pass: string, isAuto = false) {
    setLoading(true);
    setError(null);
    setInfo(isAuto ? 'Виконую автологін…' : null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // можна передати або {password}, або {token} — бекенд обробляє обидва
        body: JSON.stringify({ password: pass }),
        cache: 'no-store',
      });

      if (!res.ok) {
        const data = await safeJson(res);
        const msg =
          data?.error ||
          (res.status === 401
            ? 'Невірний пароль'
            : `Помилка авторизації (${res.status})`);
        throw new Error(msg);
      }

      // Якщо тут — бекенд виставив cookie admin_token.
      setInfo('Успішний вхід. Перенаправляю…');

      // Перенаправляємо в адмінку (можна змінити на /admin/campaigns)
      window.location.replace('/admin');
    } catch (e: any) {
      setError(e?.message || 'Щось пішло не так');
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) {
      setError('Введіть пароль');
      return;
    }
    void doLogin(password.trim(), false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl shadow-lg bg-white p-6 space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold">Адмін вхід</h1>
          <p className="text-sm text-gray-500 mt-1">
            Введіть ADMIN_PASS для доступу
          </p>
        </header>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Пароль
            </span>
            <input
              type="password"
              autoComplete="current-password"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/20"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введіть ADMIN_PASS"
              disabled={loading}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl px-4 py-2 bg-black text-white hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? 'Вхід…' : 'Увійти'}
          </button>
        </form>

        {info && (
          <div className="text-sm text-blue-600 bg-blue-50 border border-blue-100 rounded-xl p-3">
            {info}
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">
            {error}
          </div>
        )}

        <div className="text-xs text-gray-500">
          Підтримується автологін: додайте <code>?token=ВАШ_ADMIN_PASS</code> до
          URL, і сторінка сама зробить вхід.
        </div>
      </div>
    </main>
  );
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
