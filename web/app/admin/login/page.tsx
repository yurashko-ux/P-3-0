// web/app/admin/login/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function AdminLogin() {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/admin";

  useEffect(() => {
    // Підтягнути з localStorage, якщо вже був логін
    const existing = localStorage.getItem("admin_pass") || "";
    if (existing) setPass(existing);
  }, []);

  function setCookie(name: string, value: string, maxAgeSec = 60 * 60 * 24 * 90) {
    const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!pass) {
      setErr("Введи ADMIN_PASS");
      return;
    }

    // Зберігаємо і як cookie, і в localStorage
    setCookie("admin_pass", pass);
    setCookie("admin", "1"); // прапорець для зворотної сумісності
    localStorage.setItem("admin_pass", pass);

    // Переходимо на потрібну сторінку
    router.push(next);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-gray-200 p-8 shadow-sm bg-white">
        <h1 className="text-3xl font-semibold text-slate-900 mb-6">Логін адміна</h1>

        <label className="block text-sm font-medium text-slate-700 mb-2">ADMIN_PASS</label>
        <input
          type="password"
          placeholder="Введи ADMIN_PASS"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          className="w-full rounded-2xl border border-gray-300 bg-slate-50 px-4 py-3 outline-none ring-1 ring-gray-300 focus:ring-2 focus:ring-blue-500"
        />

        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}

        <button
          type="submit"
          className="mt-6 w-full rounded-2xl bg-blue-600 hover:bg-blue-700 text-white py-3 font-medium focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          Зберегти і перейти
        </button>

        <p className="mt-3 text-sm text-slate-500">
          Пароль зберігається у <code>localStorage</code> і у cookie <code>admin_pass</code> (Path=/).
        </p>
      </form>
    </div>
  );
}
