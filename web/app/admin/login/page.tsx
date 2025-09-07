// web/app/admin/login/page.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function AdminLoginPage() {
  const router = useRouter();
  const [pass, setPass] = useState('');
  const [hasSaved, setHasSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const p = typeof window !== 'undefined' ? localStorage.getItem('ADMIN_PASS') : null;
    if (p) setHasSaved(true);
  }, []);

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!pass) {
      setErr('Введи ADMIN_PASS');
      return;
    }
    // зберігаємо локально, як було
    localStorage.setItem('ADMIN_PASS', pass);
    document.cookie = `admin_pass=${encodeURIComponent(pass)}; path=/; max-age=31536000`;
    router.push('/admin/campaigns');
  }

  function go() {
    router.push('/admin/campaigns');
  }

  return (
    <main className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6">
        <h1 className="text-2xl font-semibold mb-4">Логін адміна</h1>

        {hasSaved ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Пароль уже збережено у браузері.</p>
            <button
              onClick={go}
              className="px-4 py-2 rounded-xl border bg-white"
            >
              Перейти в адмінку
            </button>
          </div>
        ) : (
          <form onSubmit={onSave} className="space-y-4">
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
              className="w-full px-4 py-2 rounded-xl border bg-white"
            >
              Зберегти і перейти
            </button>

            <p className="text-xs text-gray-500">
              Пароль зберігається у <code>localStorage</code> і в cookie <code>admin_pass</code>.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
