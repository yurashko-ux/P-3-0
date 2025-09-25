// web/app/(admin)/login/page.tsx
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AdminLoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [token, setToken] = useState(sp.get('token') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // тіло запиту: { token: "..." }
        body: JSON.stringify({ token }),
      });

      // 401 → показуємо повідомлення й не редиректимо
      if (!res.ok) {
        let msg = 'Auth failed';
        try {
          const data = await res.json();
          msg = data?.error || msg;
        } catch {
          // ignore parse errors
        }
        setError(msg);
        return;
      }

      // успіх → коротке повідомлення і редирект у список кампаній
      setOkMsg('Успішний вхід. Перенаправляю…');
      // невелика пауза, щоб користувач бачив фідбек
      setTimeout(() => {
        // важливо: повний reload, аби Next зчитав оновлені куки на сервері
        router.push('/admin/campaigns');
        router.refresh();
      }, 400);
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-sm rounded-2xl shadow-md bg-white p-6">
        <h1 className="text-xl font-semibold mb-4">Адмін вхід</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm text-neutral-700">Адмін токен</span>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2"
              placeholder="Введіть ADMIN_PASS"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
              required
            />
          </label>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {okMsg && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 text-sm">
              {okMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-black text-white py-2.5 disabled:opacity-50"
          >
            {loading ? 'Входимо…' : 'Увійти'}
          </button>
        </form>

        <p className="mt-4 text-xs text-neutral-500">
          Підказка: бекенд порівнює введене значення з <code>process.env.ADMIN_PASS</code>.
        </p>
      </div>
    </main>
  );
}
