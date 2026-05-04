"use client";

// Поле підписання фінансового звіту після звірки інкасації.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface SignFinanceReportControlProps {
  year: number;
  month: number;
  encashment: number;
  encashmentFactAltegio: number;
  isSigned: boolean;
  signedAt?: string | null;
  hasMismatch: boolean;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SignFinanceReportControl({
  year,
  month,
  encashment,
  encashmentFactAltegio,
  isSigned,
  signedAt,
  hasMismatch,
}: SignFinanceReportControlProps) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSign = () => {
    const enteredSecret = secret.trim();
    if (!enteredSecret) {
      setError("Введіть код підписання");
      return;
    }

    setError(null);
    setSuccessMessage(null);

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/finance-report/signature?secret=${encodeURIComponent(enteredSecret)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              year,
              month,
              encashment,
              encashmentFactAltegio,
            }),
          },
        );

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Не вдалося підписати звіт");
        }

        setSecret("");
        setSuccessMessage("Звіт підписано. Snapshot фінансових операцій Altegio збережено.");
        router.refresh();
      } catch (err: any) {
        setError(err?.message || "Помилка підписання звіту");
      }
    });
  };

  return (
    <div className="mt-2 rounded border border-gray-200 bg-white p-2 text-xs">
      <div className="flex flex-col gap-2">
        <div>
          <p className="font-semibold">Підписання звіту</p>
          {isSigned && signedAt ? (
            <p className="text-green-700">Підписано: {formatDateTime(signedAt)}</p>
          ) : (
            <p className="text-gray-500">
              Підпис доступний тільки коли розрахункова інкасація дорівнює факту Altegio.
            </p>
          )}
        </div>

        {!isSigned && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="Код підписання"
              className="input input-bordered input-xs w-40"
              disabled={isPending || hasMismatch}
            />
            <button
              type="button"
              onClick={handleSign}
              className="btn btn-primary btn-xs"
              disabled={isPending || hasMismatch}
              title={hasMismatch ? "Спочатку вирівняйте інкасацію та факт Altegio" : "Підписати звіт"}
            >
              {isPending ? "Підписання..." : "Підписати"}
            </button>
          </div>
        )}

        {hasMismatch && !isSigned && (
          <p className="rounded bg-yellow-50 p-1 text-yellow-700">
            Підписання заблоковано: інкасація не дорівнює факту Altegio.
          </p>
        )}

        {error && <p className="rounded bg-red-50 p-1 text-red-700">{error}</p>}
        {successMessage && <p className="rounded bg-green-50 p-1 text-green-700">{successMessage}</p>}
      </div>
    </div>
  );
}
