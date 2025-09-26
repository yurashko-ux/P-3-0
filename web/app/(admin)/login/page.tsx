// web/app/(admin)/login/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLoginPage() {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // token має збігатися з ADMIN_PASS у Vercel Env
        body: JSON.stringify({ token }),
        cache: 'no-store',
      });

      if (res.ok) {
        // успіх → бекенд поставить httpOnly cookie, переходимо в адмінку
        router.push('/admin/campaigns');
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-5"
      >
        <h1 className="text-2xl font-semibold">Admin Login</h1>

        <label className="block text-sm">
          <span className="text-gray-700">Admin token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring"
            placeholder="Enter ADMIN_PASS"
            autoFocus
          />
        </label>

        {error && (
          <p className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !token}
          className="w-full rounded-xl bg-black text-white py-2 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-xs text-gray-500">
          Підказка: значення має дорівнювати <code>ADMIN_PASS</code> у Vercel →
          Project → Settings → Environment Variables.
        </p>
      </form>
    </div>
  );
}
