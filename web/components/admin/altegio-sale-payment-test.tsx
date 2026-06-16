"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

type PaymentMethodSummary = {
  slug?: string | null;
  is_applicable?: boolean | null;
  applicable_amount?: unknown;
  applicable_count?: unknown;
  applicable_value?: unknown;
  account_id?: number | null;
  account_title?: string | null;
  balance?: unknown;
};

type ApiResponse = {
  ok?: boolean;
  dryRun?: boolean;
  endpoint?: string;
  payload?: unknown;
  paymentMethods?: PaymentMethodSummary[];
  raw?: unknown;
  error?: string;
  note?: string;
};

function buildDefaultPayload(accountId: number, amount: number) {
  return {
    payment_transactions: [
      {
        account_id: accountId,
        amount,
      },
    ],
  };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
      />
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function AltegioSalePaymentTest() {
  const [documentId, setDocumentId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("1");
  const [companyId, setCompanyId] = useState("");
  const [payloadJson, setPayloadJson] = useState(
    JSON.stringify(buildDefaultPayload(2665190, 1), null, 2),
  );
  const [payloadTouched, setPayloadTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const parsedAccountId = Number(accountId.trim());
  const parsedAmount = Number(amount.replace(",", ".").trim());

  useEffect(() => {
    if (payloadTouched) return;
    if (!Number.isFinite(parsedAccountId) || parsedAccountId <= 0) return;
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
    setPayloadJson(
      JSON.stringify(
        buildDefaultPayload(Math.trunc(parsedAccountId), Math.round(parsedAmount * 100) / 100),
        null,
        2,
      ),
    );
  }, [parsedAccountId, parsedAmount, payloadTouched]);

  const responseText = useMemo(
    () => (response ? JSON.stringify(response, null, 2) : ""),
    [response],
  );

  const paymentMethods = Array.isArray(response?.paymentMethods) ? response.paymentMethods : [];

  const buildRequestBody = useCallback(
    (dryRun: boolean) => {
      let payloadOverride: unknown;
      try {
        payloadOverride = JSON.parse(payloadJson);
      } catch (error) {
        throw new Error(
          `JSON payload некоректний: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const docId = Number(documentId.trim());
      const accId = Number(accountId.trim());
      const sum = Number(amount.replace(",", ".").trim());
      if (!Number.isFinite(docId) || docId <= 0) {
        throw new Error("document_id має бути додатнім числом");
      }
      if (!Number.isFinite(accId) || accId <= 0) {
        throw new Error("account_id має бути додатнім числом");
      }
      if (!Number.isFinite(sum) || sum <= 0) {
        throw new Error("Сума має бути додатнім числом");
      }

      return {
        ...(companyId.trim() ? { companyId: companyId.trim() } : {}),
        documentId: Math.trunc(docId),
        accountId: Math.trunc(accId),
        amount: Math.round(sum * 100) / 100,
        payloadOverride,
        dryRun,
      };
    },
    [accountId, amount, companyId, documentId, payloadJson],
  );

  const runRequest = async (dryRun: boolean) => {
    setLoading(true);
    setCopyState("idle");
    try {
      const body = buildRequestBody(dryRun);
      const res = await fetch("/api/admin/altegio/test-sale-payment", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({ ok: false, error: "Некоректна JSON-відповідь" }))) as ApiResponse;
      setHttpStatus(res.status);
      setResponse(data);
    } catch (error) {
      setHttpStatus(null);
      setResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  const onDryRun = async (event: FormEvent) => {
    event.preventDefault();
    await runRequest(true);
  };

  const onRealPost = async () => {
    try {
      buildRequestBody(true);
    } catch (error) {
      setResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const confirmed = window.confirm(
      "Увага: реальний POST створить оплату в Altegio.\n\nСпочатку перевір dry run. Продовжити?",
    );
    if (!confirmed) return;
    await runRequest(false);
  };

  const onCopy = async () => {
    if (!responseText) return;
    const ok = await copyText(responseText);
    setCopyState(ok ? "copied" : "error");
    window.setTimeout(() => setCopyState("idle"), 2000);
  };

  return (
    <div className="space-y-6">
      <form onSubmit={onDryRun} className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="document_id"
            value={documentId}
            onChange={setDocumentId}
            placeholder="123456"
            hint="ID документа продажу в Altegio"
          />
          <Field
            label="account_id"
            value={accountId}
            onChange={setAccountId}
            placeholder="2665190"
            hint="Рахунок каси / ФОП"
          />
          <Field
            label="Сума (грн)"
            value={amount}
            onChange={setAmount}
            placeholder="1"
            type="text"
          />
          <Field
            label="company_id (опціонально)"
            value={companyId}
            onChange={setCompanyId}
            placeholder="За замовчуванням з env"
          />
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">
            JSON payload для POST /company/&#123;location_id&#125;/sale/&#123;document_id&#125;/payment
          </span>
          <textarea
            value={payloadJson}
            onChange={(e) => {
              setPayloadTouched(true);
              setPayloadJson(e.target.value);
            }}
            rows={8}
            className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-blue-500"
          />
          <span className="text-xs text-slate-500">
            Автооновлюється від account_id і суми, поки ви не редагуєте вручну.
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? "Запит…" : "Dry run (без POST в Altegio)"}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onRealPost}
            className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
          >
            Реальний POST в Altegio
          </button>
          <button
            type="button"
            className="rounded-lg border px-3 py-2 text-sm"
            onClick={() => {
              setResponse(null);
              setHttpStatus(null);
              setCopyState("idle");
            }}
          >
            Очистити результат
          </button>
        </div>
      </form>

      {response ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-800">Результат</h3>
            <div className="flex items-center gap-2 text-sm">
              {httpStatus != null ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">HTTP {httpStatus}</span>
              ) : null}
              {response.dryRun === true ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">dry run</span>
              ) : response.dryRun === false ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">реальний POST</span>
              ) : null}
              <button
                type="button"
                onClick={onCopy}
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                {copyState === "copied" ? "Скопійовано" : copyState === "error" ? "Помилка копіювання" : "Скопіювати JSON"}
              </button>
            </div>
          </div>

          {response.endpoint ? (
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-700">Endpoint:</span>{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{response.endpoint}</code>
            </p>
          ) : null}

          {paymentMethods.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">slug</th>
                    <th className="px-3 py-2 font-medium">account_id</th>
                    <th className="px-3 py-2 font-medium">applicable_amount</th>
                    <th className="px-3 py-2 font-medium">balance</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentMethods.map((method, index) => (
                    <tr key={`${method.slug ?? "method"}-${index}`} className="border-t border-slate-100">
                      <td className="px-3 py-2">{method.slug ?? "—"}</td>
                      <td className="px-3 py-2">{method.account_id ?? "—"}</td>
                      <td className="px-3 py-2">{String(method.applicable_amount ?? "—")}</td>
                      <td className="px-3 py-2 font-semibold text-emerald-700">{String(method.balance ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <pre className="max-h-[32rem] overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100 select-all">
            {responseText}
          </pre>
          <p className="text-xs text-slate-500">
            Виділіть текст у блоці вище або натисніть «Скопіювати JSON», щоб надіслати результат у чат.
          </p>
        </div>
      ) : null}
    </div>
  );
}
