// web/app/admin/login/page.tsx
'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function AdminLoginPage() {
  const sp = useSearchParams();
  const [pass, setPass] = useState('');
  const next = sp.get('next') || '/admin';

  function setCookie(name: string, value: string, maxAgeSec = 60 * 60 * 24 * 30) {
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    document.cookie =
      `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax;` +
      (isHttps ? ' Secure;' : '');
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pass) return;
    try { localStorage.setItem('admin_pass', pass); } catch {}
    setCookie('admin_pass', pass); // новий механізм
    setCookie('admin', '1');       // старий механізм (сумісність)
    window.location.href = next;
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="rounded-2xl border p-6 bg-white">
        <h1 className="text-3xl font-semibold mb-6">Логін адміна</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <div className="text-sm mb-2">ADMIN_PASS</div>
            <input
              type="password"
              className="w-full rounded-2xl border px-4 py-3 bg-blue-50"
              placeholder="Введи ADMIN_PASS"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoFocus
            />
          </label>
          <button type="submit" className="w-full rounded-2xl bg-blue-600 text-white py-3">
            Зайти
          </button>
          <p className="text-sm text-gray-600">
            Ставимо куки <code>admin_pass</code> і <code>admin</code> (сумісність зі старим UI).
          </p>
        </form>
      </div>
    </div>
  );
}
