// web/app/admin/login/page.tsx
'use client';

import { useState } from 'react';

export default function AdminLoginPage() {
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!pass) {
      setErr('Введи ADMIN_PASS');
      return;
    }
    try {
      setLoading(true);
      // як було раніше: кладемо пароль у localStorage і cookie
      localStorage.setItem('ADMIN_PASS', pass);
      document.cookie = `admin_pass=${encodeURIComponent(pass)}; path=/; max-age=31536000`;
      // надійний перехід без router
      window.location.href = '/admin/campaigns';
    } catch {
      setErr('Не вдалося зберегти пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6">
        <h1 className="text-2xl font-semibold mb-4">Логін адміна</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm text-gray-700">ADMIN_PASS</span>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border px-3 py-2"
              placeholder="Введи ADMIN_PASS"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </label>

          {err && <div className="text-sm text-red-600">{err}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
          >
            {loading ? 'Зберігаю…' : 'Зберегти і перейти'}
          </button>

          <p className="text-xs text-gray-500">
            Пароль зберігається у <code>localStorage</code> і в cookie <code>admin_pass</code>.
          </p>
        </form>
      </div>
    </main>
  );
}
