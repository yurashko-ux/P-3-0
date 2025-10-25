"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import type {
  KeycrmCardSearchError,
  KeycrmCardSearchResult,
} from "@/lib/keycrm-card-search";

type RuleConfig = { op: "contains" | "equals"; value: string };

type TargetConfig = {
  pipelineId: string | null;
  statusId: string | null;
  pipelineStatusId: string | null;
  pipelineName: string | null;
  statusName: string | null;
  statusAliases?: string[];
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
  "Вставте ManyChat-повідомлення: username, повне ім'я та текст, щоб знайти кампанію та перемістити картку.";

type StepStatus = "success" | "warning" | "error" | "info";

type StepDefinition = {
  key: string;
  title: string;
  status: StepStatus;
  content: ReactNode;
};

const STEP_STYLES: Record<StepStatus, { dot: string; border: string; title: string; text: string }> = {
  success: {
    dot: "bg-emerald-500",
    border: "border-emerald-200",
    title: "text-emerald-700",
    text: "text-emerald-700",
  },
  warning: {
    dot: "bg-amber-500",
    border: "border-amber-200",
    title: "text-amber-700",
    text: "text-amber-700",
  },
  error: {
    dot: "bg-rose-500",
    border: "border-rose-200",
    title: "text-rose-700",
    text: "text-rose-700",
  },
  info: {
    dot: "bg-slate-400",
    border: "border-slate-200",
    title: "text-slate-700",
    text: "text-slate-600",
  },
};

function FlowStep({
  index,
  title,
  status,
  children,
}: {
  index: number;
  title: string;
  status: StepStatus;
  children: ReactNode;
}) {
  const style = STEP_STYLES[status];

  return (
    <li className="relative ml-0 list-none pl-6">
      <span
        className={`absolute -left-[32px] top-2 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm ${style.dot}`}
      >
        {index + 1}
      </span>
      <div className={`rounded-xl border bg-white px-4 py-3 shadow-sm ${style.border}`}>
        <div className={`text-sm font-semibold ${style.title}`}>{title}</div>
        <div className={`mt-1 space-y-1 text-sm ${style.text}`}>{children}</div>
      </div>
    </li>
  );
}

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

  const successPayload = state.status === "success" ? state.payload : null;
  let automationSteps: StepDefinition[] = [];

  if (successPayload) {
    const campaign = successPayload.match?.campaign;
    const cardMatch = successPayload.search.selected?.match || null;
    const searchSummary = successPayload.search.selected?.summary || null;
    const moveAttempted = successPayload.move.attempted;
    const moveOk = moveAttempted && successPayload.move.ok;
    const moveStatus: StepStatus = moveAttempted ? (moveOk ? "success" : "error") : "info";

    automationSteps = [
      {
        key: "message",
        title: "Отримано повідомлення ManyChat",
        status: "success",
        content: (
          <>
            <div>
              Текст: <span className="font-medium">{successPayload.normalized.text || "—"}</span>
            </div>
            <div>Username: {successPayload.normalized.handle || "—"}</div>
            <div>Ім'я: {successPayload.normalized.fullName || "—"}</div>
          </>
        ),
      },
      {
        key: "campaign",
        title: "Підібрана кампанія",
        status: campaign ? "success" : "error",
        content: campaign ? (
          <>
            <div>
              Назва: <span className="font-medium">{campaign.name || campaign.id || "—"}</span>
            </div>
            <div>
              Правило: {successPayload.match.rule.op} → "{successPayload.match.rule.value}"
            </div>
            <div>
              Базова пара: {campaign.base.pipelineName || campaign.base.pipelineId || "—"} /{" "}
              {campaign.base.statusName || campaign.base.statusId || "—"}
            </div>
            <div>
              Цільова пара: {campaign.target.pipelineName || campaign.target.pipelineId || "—"} /{" "}
              {campaign.target.statusName || campaign.target.statusId || "—"}
            </div>
          </>
        ) : (
          <div>Відповідну кампанію не знайдено.</div>
        ),
      },
      {
        key: "card",
        title: "Знайдена картка в KeyCRM",
        status: cardMatch ? "success" : "warning",
        content: cardMatch ? (
          <>
            <div>
              Картка #{cardMatch.cardId}: <span className="font-medium">{cardMatch.title}</span>
            </div>
            <div>
              Збіг за {cardMatch.matchedField}: {cardMatch.matchedValue}
            </div>
            {searchSummary && (
              <div>
                Поточна пара: {searchSummary.pipelineName || searchSummary.pipelineId || "—"} /{" "}
                {searchSummary.statusName || searchSummary.statusId || "—"}
              </div>
            )}
          </>
        ) : (
          <div>Картку не знайдено у базовій воронці. Перевірте вхідні дані або налаштування кампанії.</div>
        ),
      },
      {
        key: "move",
        title: "Переміщення картки",
        status: moveStatus,
        content: moveAttempted ? (
          <>
            <div>{moveOk ? "Переміщення підтверджено." : "Переміщення не підтверджено."}</div>
            <div>HTTP статус: {successPayload.move.status ?? "—"}</div>
            {!moveOk && successPayload.move.skippedReason && (
              <div>Причина: {successPayload.move.skippedReason}</div>
            )}
          </>
        ) : (
          <>
            <div>Переміщення не виконувалось.</div>
            {successPayload.move.skippedReason && (
              <div>Причина: {successPayload.move.skippedReason}</div>
            )}
          </>
        ),
      },
    ];
  }

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
            <span className="text-slate-600">Повне ім'я</span>
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
          {automationSteps.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Послідовність автоматизації</h3>
              <ol className="relative space-y-4 border-l border-slate-200 pl-6">
                {automationSteps.map((step, index) => (
                  <FlowStep key={step.key} index={index} title={step.title} status={step.status}>
                    {step.content}
                  </FlowStep>
                ))}
              </ol>
            </div>
          )}

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
                Правило: {state.payload.match.rule.op} → "{state.payload.match.rule.value}"
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
