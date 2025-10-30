"use client";

import { useState } from "react";

import type {
  KeycrmCardSearchError,
  KeycrmCardSearchResult,
} from "@/lib/keycrm-card-search";

type RuleConfig = { op: "contains" | "equals"; value: string };

type TargetConfig = {
  pipelineId: string | null;
  statusId: string | null;
  pipelineName: string | null;
  statusName: string | null;
};

type ApiSuccess = {
  ok: true;
  normalized: {
    handle: string | null;
    handleRaw: string | null;
    text: string;
    fullName: string;
  };
  match: {
    route: "v1" | "v2";
    rule: RuleConfig;
    campaign: {
      id: string | null;
      name: string | null;
      base: TargetConfig;
      target: TargetConfig;
    };
  };
  search: {
    usedNeedle: string | null;
    attempts: Array<{
      kind: string;
      value: string;
      result: KeycrmCardSearchResult | KeycrmCardSearchError;
    }>;
    selected: (KeycrmCardSearchResult & { summary: TargetConfig | null }) | null;
  };
  move: {
    attempted: boolean;
    skippedReason?: string;
    response?: unknown;
    status?: number;
    ok: boolean;
  };
};

type ApiError = {
  ok: false;
  error: string;
  details?: unknown;
};

type State =
  | { status: "idle"; message: string }
  | { status: "loading" }
  | { status: "error"; payload: ApiError; statusCode: number }
  | { status: "success"; payload: ApiSuccess; statusCode: number };

const INITIAL_MESSAGE =
  "Вставте ManyChat-повідомлення: username, повне ім&rsquo;я та текст, щоб знайти кампанію та перемістити картку.";

function TargetBadge({ target, label }: { target: TargetConfig; label: string }) {
  const name = target.pipelineName || target.pipelineId || "—";
  const status = target.statusName || target.statusId || "—";
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
      <div className="text-xs uppercase text-slate-400">{label}</div>
      <div className="font-medium text-slate-700">{name}</div>
      <div className="text-slate-500">Статус: {status}</div>
    </div>
  );
}

function AttemptRow({
  attempt,
}: {
  attempt: { kind: string; value: string; result: KeycrmCardSearchResult | KeycrmCardSearchError };
}) {
  const ok = attempt.result.ok;
  const label = ok ? "✓" : "✕";
  return (
    <div className="flex items-start justify-between rounded-lg border px-3 py-2 text-sm">
      <div>
        <div className="font-medium text-slate-700">
          {attempt.kind}: <span className="text-slate-500">{attempt.value}</span>
        </div>
        {!ok && (
          <div className="text-xs text-red-500">
            Помилка: {(attempt.result as KeycrmCardSearchError).error}
          </div>
        )}
        {ok && !attempt.result.match && (
          <div className="text-xs text-slate-500">Без точного збігу, карток перевірено: {attempt.result.cardsChecked}</div>
        )}
      </div>
      <span className={`text-sm font-semibold ${ok ? "text-emerald-600" : "text-red-500"}`}>{label}</span>
    </div>
  );
}

function JsonViewer({ value }: { value: unknown }) {
  try {
    return (
      <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900/90 p-3 text-xs text-slate-100">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  } catch (err) {
    return <div className="text-sm text-red-500">JSON error: {String(err)}</div>;
  }
}

export function ManychatCampaignRouter() {
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ status: "idle", message: INITIAL_MESSAGE });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      message: {
        username: username.trim() || undefined,
        full_name: fullName.trim() || undefined,
        text: text.trim(),
      },
    };

    setState({ status: "loading" });
    try {
      const res = await fetch("/api/admin/test/manychat", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json().catch(() => null)) as ApiSuccess | ApiError | null;

      if (!json) {
        setState({
          status: "error",
          statusCode: res.status,
          payload: { ok: false, error: "invalid_response" },
        });
        return;
      }

      if (!res.ok) {
        const payload: ApiError = json.ok === false ? json : { ok: false, error: `http_${res.status}` };
        setState({ status: "error", statusCode: res.status, payload });
        return;
      }

      if (!json.ok) {
        const errorPayload = json as ApiError;
        setState({ status: "error", statusCode: res.status, payload: errorPayload });
        return;
      }

      setState({ status: "success", payload: json, statusCode: res.status });
    } catch (err) {
      setState({
        status: "error",
        statusCode: 0,
        payload: {
          ok: false,
          error: "network_error",
          details: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-slate-800">ManyChat → KeyCRM тест</h2>
        <p className="text-sm text-slate-500">
          Порівнює текст повідомлення з правилами V1/V2 кампаній, шукає картку в базовій воронці та
          переносить її у цільову пару.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">IG username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@username"
              className="rounded-lg border px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Повне ім&rsquo;я</span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Viktoria Kolachnyk"
              className="rounded-lg border px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Текст повідомлення</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Наприклад: хочу записатись на процедуру v1"
            className="min-h-[100px] rounded-lg border px-3 py-2 text-sm outline-none focus:border-indigo-500"
            required
          />
        </label>

        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-300"
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? "Опрацьовуємо…" : "Запустити пошук"}
        </button>
      </form>

      {state.status === "idle" && (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">{state.message}</p>
      )}

      {state.status === "error" && (
        <div className="mt-4 space-y-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-semibold">Помилка ({state.statusCode || "—"}): {state.payload.error}</div>
          {state.payload.details && <JsonViewer value={state.payload.details} />}
        </div>
      )}

      {state.status === "success" && (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <TargetBadge target={state.payload.match.campaign.base} label="Базова воронка" />
            <TargetBadge target={state.payload.match.campaign.target} label="Цільова воронка" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border px-4 py-3 text-sm">
              <div className="text-xs uppercase text-slate-400">Кампанія</div>
              <div className="font-semibold text-slate-800">
                {state.payload.match.campaign.name || state.payload.match.campaign.id || "Без назви"}
              </div>
              <div className="text-slate-500">Маршрут: {state.payload.match.route.toUpperCase()}</div>
              <div className="text-xs text-slate-500">
                Правило: {state.payload.match.rule.op} → &quot;{state.payload.match.rule.value}&quot;
              </div>
            </div>

            <div className="rounded-xl border px-4 py-3 text-sm">
              <div className="text-xs uppercase text-slate-400">ManyChat</div>
              <div className="text-slate-600">handle: {state.payload.normalized.handle || "—"}</div>
              <div className="text-slate-600">full name: {state.payload.normalized.fullName || "—"}</div>
              <div className="text-slate-500">text: {state.payload.normalized.text || "—"}</div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Спроби пошуку</h3>
            <div className="space-y-2">
              {state.payload.search.attempts.map((attempt) => (
                <AttemptRow key={`${attempt.kind}:${attempt.value}`} attempt={attempt} />
              ))}
            </div>
          </div>

          {state.payload.search.selected && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">Результат пошуку</h3>
              <div className="rounded-xl border px-4 py-3 text-sm">
                <div className="font-medium text-slate-800">
                  Картка #{state.payload.search.selected.match?.cardId}
                </div>
                <div className="text-slate-600">{state.payload.search.selected.match?.title || "Без назви"}</div>
                <div className="text-xs text-slate-500">
                  Збіг: {state.payload.search.selected.match?.matchedField} →
                  {" "}
                  {state.payload.search.selected.match?.matchedValue}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">Переміщення</h3>
            <div className="rounded-xl border px-4 py-3 text-sm">
              {state.payload.move.attempted ? (
                <>
                  <div className="font-medium text-slate-800">Виконано через API</div>
                  <div className="text-slate-500">HTTP статус: {state.payload.move.status ?? "—"}</div>
                </>
              ) : (
                <div className="text-slate-500">
                  Пропущено: {state.payload.move.skippedReason || "невідомо"}
                </div>
              )}
              {state.payload.move.response && <JsonViewer value={state.payload.move.response} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
