"use client";

import { useState } from "react";

function formatKop(kop: string | number): string {
  const value = Number(kop || 0) / 100;
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function todayKyivYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function IncomingReconcileTestPage() {
  const [day, setDay] = useState(todayKyivYmd());
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function runReconcile() {
    setMsg(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setMsg("❌ Дата має бути у форматі YYYY-MM-DD");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/bank/payment-reconciliation/incoming/reconcile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day,
          dryRun,
          matchedBy: "admin_tools_test",
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || `${res.status} ${res.statusText}`);
      }

      const result = payload.result;
      const lines = [
        dryRun ? "🔍 Попередній перегляд (dry run)" : "✅ Зведення виконано",
        `День: ${result.kyivDay}`,
        `Рахунків зведено: ${result.matchedAccounts}`,
        `Банківських рядків: ${result.matchedBankItems}`,
        `Еквайринг (Altegio): ${result.acquiringExpensesCreated}`,
        `Пропущено (різниця сум): ${result.skippedDiffNonZero}`,
        `Пропущено (вже зведено): ${result.skippedAlreadyMatched}`,
      ];

      if (result.skippedDetails?.length) {
        lines.push("", "Пропущені рахунки:");
        for (const detail of result.skippedDetails) {
          lines.push(
            `• ${detail.accountTitle}: Altegio ${formatKop(detail.altegioTotalKop)} ₴ | Банк ${formatKop(detail.bankFullTotalKop)} ₴ | Δ ${formatKop(detail.diffKop)} ₴ (${detail.reason})`,
          );
        }
      }

      if (result.details?.length) {
        lines.push("", "Зведені рахунки:");
        for (const detail of result.details) {
          lines.push(
            `• ${detail.accountTitle}: Altegio ${formatKop(detail.altegioTotalKop)} ₴ | Банк ${formatKop(detail.bankFullTotalKop)} ₴ | ${detail.bankItemIds.length} банк., еквайринг ${detail.acquiringExpensesCreated}`,
          );
        }
      }

      if (result.errors?.length) {
        lines.push("", "Помилки:", ...result.errors.map((e: string) => `  - ${e}`));
      }

      lines.push("", JSON.stringify(result, null, 2));
      setMsg(lines.join("\n"));
    } catch (error) {
      setMsg(`❌ ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 text-xl font-bold text-gray-900">Тест: автозведення вхідних платежів</h1>
      <p className="mb-6 text-sm text-gray-600">
        Безготівкові платежі за один київський день. Збіг за рахунками та повною сумою банку.
        Еквайринг створює вихідний платіж у Altegio без Telegram.
      </p>

      <form
        className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void runReconcile();
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-800">Дата зведення (київський день)</span>
          <input
            type="date"
            className="input input-bordered w-full"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={dryRun}
            onChange={(event) => setDryRun(event.target.checked)}
          />
          <span>Лише перегляд (dry run) — без запису в БД і без Altegio</span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Виконується…" : dryRun ? "Перевірити зведення" : "Звести"}
          </button>
          <a
            href="/admin/direct/payment-reconciliation"
            className="btn btn-ghost"
          >
            До платежів / зведення
          </a>
        </div>
      </form>

      {msg ? (
        <pre className="mt-4 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-900">
          {msg}
        </pre>
      ) : null}
    </main>
  );
}
