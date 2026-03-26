// web/app/admin/db-test/page.tsx
// Діагностика підключення до БД (той самий Prisma / DATABASE_URL, що й застосунок)

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

function getTodayKyiv(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

type DbTestItem = {
  name: string;
  success: boolean;
  [key: string]: unknown;
};

type CheckDbPayload = {
  ok?: boolean;
  diagnostics?: {
    timestamp?: string;
    databaseUrl?: {
      exists?: boolean;
      length?: number;
      preview?: string;
      containsPooler?: boolean;
      containsPgBouncer?: boolean;
      containsPrisma?: boolean;
      host?: string;
      port?: string;
    };
    tests?: DbTestItem[];
  };
  recommendations?: string[];
};

type RecordCreatedPayload = {
  ok?: boolean;
  todayKyiv?: string;
  monthToDate?: number;
  today?: number;
  error?: string;
};

export default function AdminDbTestPage() {
  const [day, setDay] = useState<string>(() => getTodayKyiv());
  const [loading, setLoading] = useState(false);
  const [checkDb, setCheckDb] = useState<CheckDbPayload | null>(null);
  const [checkDbError, setCheckDbError] = useState<string | null>(null);
  const [recordCreated, setRecordCreated] = useState<RecordCreatedPayload | null>(null);
  const [recordCreatedError, setRecordCreatedError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setCheckDbError(null);
    setRecordCreatedError(null);
    const init: RequestInit = { credentials: "include", cache: "no-store" };
    try {
      const [resCheck, resF4] = await Promise.all([
        fetch("/api/admin/direct/check-db-connection", init),
        fetch(
          `/api/admin/direct/stats/record-created-counts?day=${encodeURIComponent(day)}`,
          init
        ),
      ]);

      const jCheck = (await resCheck.json()) as CheckDbPayload;
      const jF4 = (await resF4.json()) as RecordCreatedPayload;

      if (!resCheck.ok) {
        setCheckDbError(jCheck && typeof jCheck === "object" && "error" in jCheck ? String((jCheck as { error?: string }).error) : `HTTP ${resCheck.status}`);
        setCheckDb(null);
      } else {
        setCheckDb(jCheck);
      }

      if (!resF4.ok) {
        setRecordCreatedError(jF4?.error || `HTTP ${resF4.status}`);
        setRecordCreated(null);
      } else {
        setRecordCreated(jF4);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCheckDbError(msg);
      setRecordCreatedError(msg);
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);

  const preview = checkDb?.diagnostics?.databaseUrl?.preview;

  return (
    <div className="min-h-screen bg-base-200 p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Тест підключення до БД</h1>
            <p className="mt-1 max-w-prose text-sm text-base-content/70">
              Використовується той самий Prisma та змінні оточення (<code className="text-xs">DATABASE_URL</code> /{" "}
              <code className="text-xs">PRISMA_DATABASE_URL</code>), що й основний застосунок.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? <span className="loading loading-spinner loading-sm" /> : null}
            Оновити
          </button>
        </div>

        <div className="card bg-base-100 shadow-sm">
          <div className="card-body">
            <h2 className="card-title text-lg">Перевірка з’єднання</h2>
            <p className="text-sm text-base-content/60">GET /api/admin/direct/check-db-connection</p>
            {checkDbError ? (
              <div className="alert alert-error text-sm">{checkDbError}</div>
            ) : checkDb ? (
              <div className="space-y-3 text-sm">
                <p>
                  <span className="font-semibold">Статус:</span>{" "}
                  <span className={checkDb.ok ? "text-success" : "text-warning"}>
                    {checkDb.ok ? "ok (усі тести пройшли)" : "є помилки в тестах"}
                  </span>
                </p>
                {preview ? (
                  <p>
                    <span className="font-semibold">Preview URL (масковано):</span>{" "}
                    <code className="break-all rounded bg-base-200 px-1 py-0.5 text-xs">{preview}</code>
                  </p>
                ) : null}
                {checkDb.diagnostics?.databaseUrl ? (
                  <ul className="list-inside list-disc text-xs text-base-content/80">
                    <li>host: {checkDb.diagnostics.databaseUrl.host}</li>
                    <li>port: {checkDb.diagnostics.databaseUrl.port}</li>
                    <li>pooler / pgbouncer / prisma у рядку:{" "}
                      {[
                        checkDb.diagnostics.databaseUrl.containsPooler && "pooler",
                        checkDb.diagnostics.databaseUrl.containsPgBouncer && "pgbouncer",
                        checkDb.diagnostics.databaseUrl.containsPrisma && "prisma",
                      ]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </li>
                  </ul>
                ) : null}
                {checkDb.diagnostics?.tests?.length ? (
                  <ul className="space-y-1 rounded-lg bg-base-200 p-3">
                    {checkDb.diagnostics.tests.map((t, i) => (
                      <li key={i} className="text-xs">
                        <span className={t.success ? "text-success" : "text-error"}>
                          {t.success ? "✓" : "✗"}
                        </span>{" "}
                        {t.name}
                        {!t.success && t.error != null ? (
                          <span className="text-error"> — {String(t.error)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {(checkDb.recommendations?.length ?? 0) > 0 ? (
                  <div>
                    <p className="font-semibold">Рекомендації</p>
                    <ul className="mt-1 list-inside list-disc text-xs">
                      {checkDb.recommendations!.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-base-content/60">Немає даних.</p>
            )}
          </div>
        </div>

        <div className="card bg-base-100 shadow-sm">
          <div className="card-body">
            <h2 className="card-title text-lg">F4: нові записи (record-created-counts)</h2>
            <p className="text-sm text-base-content/60">
              GET /api/admin/direct/stats/record-created-counts?day=… (день у Europe/Kyiv)
            </p>
            <label className="form-control w-full max-w-xs">
              <span className="label-text text-xs">День (YYYY-MM-DD)</span>
              <input
                type="date"
                className="input input-bordered input-sm w-full max-w-xs"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            {recordCreatedError ? (
              <div className="alert alert-error text-sm">{recordCreatedError}</div>
            ) : recordCreated?.ok ? (
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-base-content/60">todayKyiv</dt>
                  <dd className="font-mono">{recordCreated.todayKyiv}</dd>
                </div>
                <div>
                  <dt className="text-base-content/60">monthToDate</dt>
                  <dd>{recordCreated.monthToDate}</dd>
                </div>
                <div>
                  <dt className="text-base-content/60">today</dt>
                  <dd>{recordCreated.today}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-base-content/60">Немає даних.</p>
            )}
          </div>
        </div>

        <p className="text-center text-sm">
          <Link href="/admin/direct" className="link link-primary">
            ← Назад до Direct
          </Link>
        </p>
      </div>
    </div>
  );
}
