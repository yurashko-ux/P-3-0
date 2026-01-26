// web/app/admin/login/LoginClient.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginClient() {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/admin/direct";

  useEffect(() => {
    // допоміжно: автопідстановка якщо вже логінилися
    const existing = typeof window !== "undefined" ? localStorage.getItem("admin_pass") || "" : "";
    if (existing) setPass(existing);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!pass) {
      setErr("Введи ADMIN_PASS");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pass }),
        cache: "no-store",
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `login failed (${r.status})`);
      }
      // необов'язково: для UX збережемо в localStorage
      localStorage.setItem("admin_pass", pass);
      router.replace(next);
    } catch (e: any) {
      setErr(e?.message || "Помилка логіну");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-2xl border border-gray-200 p-8 shadow-sm bg-white"
      >
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
          disabled={loading}
          className="mt-6 w-full rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-3 font-medium focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          {loading ? "Вхід…" : "Зберегти і перейти"}
        </button>

        <p className="mt-3 text-sm text-slate-500">
          Сервер встановлює cookie <code>admin_pass</code> та <code>admin</code> (HttpOnly, Path=/).
        </p>
      </form>
    </div>
  );
}
