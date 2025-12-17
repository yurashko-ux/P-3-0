"use client";

import { useSearchParams } from "next/navigation";
import { useState, FormEvent, Suspense } from "react";

function FinanceReportLoginForm() {
  const searchParams = useSearchParams();
  const hasError = searchParams.get("err") === "1" || searchParams.get("err") === "auth";
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);

    const token = (pwd || "").trim();
    if (!token) {
      setLocalError("Введіть пароль для фінансового звіту");
      return;
    }

    setBusy(true);
    // Редірект у розділ фінансового звіту, middleware обробить ?fr_token=
    window.location.href = `/admin/finance-report?fr_token=${encodeURIComponent(token)}`;
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl shadow p-6 bg-white">
        <h1 className="text-xl font-semibold mb-4 text-center">
          Вхід у розділ "Фінансовий звіт"
        </h1>

        {(hasError || localError) && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {localError || "Невірний пароль. Спробуйте ще раз."}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Пароль для фінансового звіту</label>
            <input
              type="password"
              autoFocus
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 outline-none focus:ring"
              placeholder="Введіть пароль"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl px-4 py-2 border bg-black text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Входимо…" : "Увійти"}
          </button>
        </form>

        <p className="text-xs text-gray-500 mt-4 text-center">
          Після успішного логіну відкриється сторінка <code>/admin/finance-report</code>.
        </p>
      </div>
    </main>
  );
}

export default function FinanceReportLoginPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl shadow p-6 bg-white">
          <div className="text-center">Завантаження...</div>
        </div>
      </main>
    }>
      <FinanceReportLoginForm />
    </Suspense>
  );
}
