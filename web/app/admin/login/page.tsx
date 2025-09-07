// web/app/admin/login/page.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function AdminLoginPage() {
  const router = useRouter();
  const [pass, setPass] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    const p = localStorage.getItem('ADMIN_PASS');
    if (p) setSaved(p);
  }, []);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!pass) return;
    localStorage.setItem('ADMIN_PASS', pass);
    // необов’язково, але корисно мати cookie для інших клієнтських запитів
    document.cookie = `admin_pass=${encodeURIComponent(pass)}; path=/; max-age=31536000`;
    router.push('/admin/campaigns');
  }

  function clearPass() {
    localStorage.removeItem('ADMIN_PASS');
    document.cookie = 'admin_pass=; path=/; max-age=0';
    setSaved(null);
    setPass('');
  }

  return (
    <main className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-4">Логін адміна</h1>

        {saved ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Пароль вже збережений у браузері. Можеш перейти в адмінку або скинути його.
            </p>
            <div className="flex gap-2">
              <a href="/admin/campaigns" className="px-4 py-2 rounded-xl bg-black text-white">
                До кампаній
              </a>
              <button
                onClick={clearPass}
                className="px-4 py-2 rounded-xl border"
              >
                Скинути пароль
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
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
            <button type="submit" className="w-full px-4 py-2 rounded-xl bg-black text-white">
              Зберегти і перейти
            </button>
            <p className="text-xs text-gray-500">
              Пароль збережеться локально (localStorage) і в cookie <code>admin_pass</code>.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
