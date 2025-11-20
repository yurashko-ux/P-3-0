"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { KeycrmMoveAttempt } from "@/lib/keycrm-move";
import type { SearchAttempt } from "@/lib/manychat-routing";

type LatestMessage = {
  id: number | string | null;
  receivedAt: number | string | null;
  source: string;
  title: string;
  handle: string | null;
  fullName: string | null;
  text: string;
  raw: unknown | null;
  rawText?: string | null;
};

type RawSnapshot = {
  raw: unknown | null;
  text: string | null;
  rawText?: string | null;
  source: string | null;
};

type RequestSnapshot = {
  rawText: string | null;
  receivedAt: number | null;
  source: string | null;
};

type WebhookTrace = {
  receivedAt: number;
  status: "accepted" | "rejected";
  reason?: string | null;
  statusCode?: number | null;
  handle?: string | null;
  fullName?: string | null;
  messagePreview?: string | null;
};

type Diagnostics = {
  api?: {
    ok: boolean;
    message?: string;
    note?: string;
  } | null;
  kvConfig?: {
    hasBaseUrl: boolean;
    hasReadToken: boolean;
    hasWriteToken: boolean;
    candidates: number;
  } | null;
  kv?: {
    ok: boolean;
    key: string;
    source: 'memory' | 'kv' | 'miss' | 'error';
    message?: string;
  } | null;
  kvTrace?: {
    ok: boolean;
    key: string;
    source: 'kv' | 'miss' | 'error';
    message?: string;
  } | null;
  kvRaw?: {
    ok: boolean;
    key: string;
    source: 'kv' | 'miss' | 'error';
    message?: string;
  } | null;
  kvRequest?: {
    ok: boolean;
    key: string;
    source: 'kv' | 'miss' | 'error';
    message?: string;
  } | null;
  kvFeed?: {
    ok: boolean;
    key: string;
    source: 'kv' | 'miss' | 'error';
    count?: number;
    message?: string;
  } | null;
  traceFallback?: {
    used: boolean;
    reason: string;
  } | null;
  automation?: {
    ok: boolean;
    error?: string;
  } | null;
};

type AutomationResult =
  | {
      ok: true;
      normalized: {
        handle: string | null;
        handleRaw: string | null;
        text: string;
        fullName: string;
      };
      match: {
        route: 'v1' | 'v2';
        rule: { op: 'contains' | 'equals'; value: string };
        campaign: {
          id: string | null;
          name: string | null;
          base: TargetSummary;
          target: TargetSummary;
        };
      };
      search: {
        usedNeedle: string | null;
        attempts: Array<{
          kind: string;
          value: string;
          result: { ok: boolean; error?: string };
        }>;
        selected:
          | ({
              match: {
                cardId: number;
                title: string | null;
                matchedField: string;
                matchedValue: string | null;
              } | null;
              summary: TargetSummary | null;
            }
            & Record<string, unknown>)
          | null;
      };
      move: {
        attempted: boolean;
        skippedReason?: string;
        response?: unknown;
        status?: number;
        ok: boolean;
        error?: string;
        details?: unknown;
        sent?: Record<string, unknown> | null;
        attempts?: KeycrmMoveAttempt[];
        requestUrl?: string | null;
        requestMethod?: string | null;
        baseUrl?: string | null;
      };
    }
  | { ok: false; error: string; details?: unknown };

type TargetSummary = {
  pipelineId: string | null;
  statusId: string | null;
  pipelineStatusId: string | null;
  pipelineName: string | null;
  statusName: string | null;
  statusAliases?: string[] | null;
};

type MoveHistoryEntry = {
  attempt?: string;
  status?: number;
  ok?: boolean;
  sent?: Record<string, unknown> | null;
  verification?: KeycrmMoveAttempt[];
  body?: unknown;
  error?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const formatJsonPreview = (value: unknown, limit = 240): string => {
  if (value == null) return "—";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "—";
    return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
  }

  try {
    const json = JSON.stringify(value);
    if (!json) return "—";
    return json.length > limit ? `${json.slice(0, limit)}…` : json;
  } catch {
    const fallback = String(value);
    return fallback.length > limit ? `${fallback.slice(0, limit)}…` : fallback;
  }
};

const translateSkipReason = (reason: string): string => {
  switch (reason) {
    case "already_in_target":
      return "Картка вже у цільовій воронці та статусі";
    case "move_handler_missing":
      return "На сервері недоступна функція переміщення";
    case "campaign_target_status_missing":
      return "Кампанія не містить цільового статусу для переміщення";
    case "card_not_in_base":
      return "Картка знаходиться поза базовою парою кампанії";
    default:
      return reason;
  }
};

const renderJsonBlock = (
  key: string,
  label: string,
  value: unknown,
): ReactNode | null => {
  if (value == null) return null;

  let formatted: string | null = null;
  if (typeof value === "string") {
    formatted = value.trim();
  } else {
    try {
      formatted = JSON.stringify(value, null, 2);
    } catch (error) {
      formatted = String(error instanceof Error ? error.message : value);
    }
  }

  if (!formatted) return null;

  return (
    <div
      key={key}
      className="mt-2 space-y-1 rounded-lg border border-slate-200/80 bg-white/80 p-2 text-left"
    >
      <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-600">
        {label}
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[0.7rem] leading-tight text-slate-700">
        {formatted}
      </pre>
    </div>
  );
};

const extractMoveHistory = (response: unknown): MoveHistoryEntry[] => {
  if (!isRecord(response)) return [];
  const history = (response as { history?: unknown }).history;
  if (!Array.isArray(history)) return [];

  const result: MoveHistoryEntry[] = [];

  for (const entry of history) {
    if (!isRecord(entry)) continue;

    const verificationRaw = Array.isArray(entry.verification)
      ? (entry.verification as KeycrmMoveAttempt[])
      : undefined;

    result.push({
      attempt: typeof entry.attempt === "string" ? entry.attempt : undefined,
      status: typeof entry.status === "number" ? entry.status : undefined,
      ok: typeof entry.ok === "boolean" ? entry.ok : undefined,
      sent: isRecord(entry.sent) ? (entry.sent as Record<string, unknown>) : null,
      verification: verificationRaw,
      body: entry.body,
      error: typeof entry.error === "string" ? entry.error : undefined,
    });
  }

  return result;
};

const formatVerificationLines = (verification: KeycrmMoveAttempt[] | undefined) => {
  if (!verification || verification.length === 0) return [] as string[];

  return verification.slice(0, 4).map((attempt, index) => {
    const pipeline = attempt.snapshot?.pipelineId ?? "—";
    const status = attempt.snapshot?.statusId ?? "—";
    const pipelineFlag = attempt.pipelineMatches ? "✅" : "⚠️";
    const statusFlag = attempt.statusMatches ? "✅" : "⚠️";

    return `#${index + 1}: воронка ${pipeline} ${pipelineFlag} · статус ${status} ${statusFlag}`;
  });
};

const normaliseIdValue = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const uniqueIds = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalised = normaliseIdValue(value);
    if (!normalised || seen.has(normalised)) continue;
    seen.add(normalised);
    result.push(normalised);
  }
  return result;
};

const formatIdList = (values: Array<string | null | undefined>) => {
  const ids = uniqueIds(values);
  return ids.length ? ids.join(", ") : "—";
};

const formatTargetLabel = (summary: TargetSummary | null | undefined) => {
  if (!summary) return "—";
  const pipelineLabel = summary.pipelineName ?? summary.pipelineId ?? "—";
  const statusLabel =
    summary.statusName ?? summary.statusId ?? summary.pipelineStatusId ?? "—";
  const identifiers = formatIdList([
    summary.statusId,
    summary.pipelineStatusId,
    ...(summary.statusAliases ?? []),
  ]);
  return identifiers === "—"
    ? `${pipelineLabel} → ${statusLabel}`
    : `${pipelineLabel} → ${statusLabel} (ID: ${identifiers})`;
};

const formatAttemptSnapshot = (attempt: KeycrmMoveAttempt | null | undefined) => {
  if (!attempt?.snapshot) return "—";
  const pipeline = attempt.snapshot.pipelineId ?? "—";
  const status = attempt.snapshot.statusId ?? "—";
  return `${pipeline} → ${status}`;
};

type InboxState =
  | {
      status: "loading";
      trace: WebhookTrace | null;
      diagnostics: Diagnostics | null;
      automation: AutomationResult | null;
      automationAnalysis: AutomationResult | null;
    }
  | {
      status: "ready";
      messages: LatestMessage[];
      lastMessage: LatestMessage | null;
      updatedAt: Date;
      source: string | null;
      trace: WebhookTrace | null;
      diagnostics: Diagnostics | null;
      rawSnapshot: RawSnapshot | null;
      requestSnapshot: RequestSnapshot | null;
      automation: AutomationResult | null;
      automationAnalysis: AutomationResult | null;
    }
  | {
      status: "error";
      message: string;
      trace: WebhookTrace | null;
      diagnostics: Diagnostics | null;
      automation: AutomationResult | null;
      automationAnalysis: AutomationResult | null;
    };

type TimelineStatus = "success" | "warning" | "error" | "info";

type TimelineStep = {
  key: string;
  title: string;
  status: TimelineStatus;
  details: ReactNode[];
};

type AutomationErrorStage = "message" | "campaign" | "search" | "move";

type AutomationErrorMeta = {
  stage: AutomationErrorStage;
  step: number;
  title: string;
  module: string;
  hint?: string;
};

const AUTOMATION_ERROR_META: Record<string, AutomationErrorMeta> = {
  invalid_json: {
    stage: "message",
    step: 1,
    title: "Отримання повідомлення",
    module: "web/app/api/mc/manychat/route.ts → normalizeManyChat",
    hint: "ManyChat надіслав невалідний JSON або тіло вебхука порожнє.",
  },
  identity_missing: {
    stage: "message",
    step: 1,
    title: "Пошук ідентифікаторів",
    module: "web/lib/manychat-routing.ts → resolveIdentityCandidates",
    hint: "У повідомленні нема username/full name для пошуку картки.",
  },
  campaign_not_found: {
    stage: "campaign",
    step: 2,
    title: "Визначення кампанії",
    module: "web/lib/manychat-routing.ts → matchCampaignByRules",
    hint: "Перевірте правила V1/V2 та значення в KV.",
  },
  campaign_base_missing: {
    stage: "campaign",
    step: 2,
    title: "Перевірка базової пари",
    module: "web/lib/manychat-routing.ts → normaliseCampaignBase",
    hint: "У кампанії не вказано базову воронку чи статус.",
  },
  campaign_target_missing: {
    stage: "campaign",
    step: 2,
    title: "Перевірка цільової пари",
    module: "web/lib/manychat-routing.ts → normaliseCampaignTarget",
    hint: "У кампанії відсутні цільові воронка/статус.",
  },
  campaign_target_status_missing: {
    stage: "campaign",
    step: 2,
    title: "Статус цільової пари",
    module: "web/lib/manychat-routing.ts → resolveTargetStatus",
    hint: "Кеш воронок KeyCRM не повернув pipeline_status_id для обраного статусу.",
  },
  keycrm_search_failed: {
    stage: "search",
    step: 3,
    title: "Пошук картки у KeyCRM",
    module: "web/lib/keycrm-card-search.ts",
    hint: "KeyCRM повернув помилку під час пошуку картки.",
  },
  card_not_found: {
    stage: "search",
    step: 3,
    title: "Пошук картки у KeyCRM",
    module: "web/lib/manychat-routing.ts → pickCardMatch",
    hint: "Немає картки у базовій воронці, що відповідає критеріям.",
  },
  card_match_missing: {
    stage: "search",
    step: 3,
    title: "Валідація збігу картки",
    module: "web/lib/manychat-routing.ts → ensureCardMatch",
  },
  card_not_in_base: {
    stage: "search",
    step: 3,
    title: "Перевірка базової пари",
    module: "web/lib/manychat-routing.ts → ensureCardInBase",
    hint: "Картку знайдено, але вона вже не у стартовому статусі кампанії.",
  },
  keycrm_move_failed: {
    stage: "move",
    step: 4,
    title: "Переміщення картки",
    module: "web/lib/keycrm-move.ts",
    hint: "KeyCRM повернув помилку або не підтвердив зміну статусу.",
  },
  keycrm_not_configured: {
    stage: "move",
    step: 4,
    title: "Переміщення картки",
    module: "web/app/api/mc/manychat/route.ts → performMove",
    hint: "Не налаштовані KEYCRM_API_URL чи KEYCRM_API_TOKEN.",
  },
  automation_exception: {
    stage: "move",
    step: 4,
    title: "Виконання автоматизації",
    module: "web/app/api/mc/manychat/route.ts",
  },
};

const STAGE_TO_STEP_KEY: Record<AutomationErrorStage, TimelineStep["key"]> = {
  message: "message",
  campaign: "campaign",
  search: "card",
  move: "move",
};

const describeAutomationError = (code: string): AutomationErrorMeta =>
  AUTOMATION_ERROR_META[code] ?? {
    stage: "move",
    step: 4,
    title: "Переміщення картки",
    module: "web/lib/manychat-routing.ts",
  };

const coerceString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const toTargetSummaryFromDetails = (input: unknown): TargetSummary => {
  if (!input || typeof input !== "object") {
    return {
      pipelineId: null,
      statusId: null,
      pipelineStatusId: null,
      pipelineName: null,
      statusName: null,
      statusAliases: null,
    };
  }
  const record = input as Record<string, unknown>;
  return {
    pipelineId:
      coerceString(record.pipelineId) ??
      coerceString(record.pipeline_id) ??
      coerceString(record.pipeline),
    statusId:
      coerceString(record.statusId) ??
      coerceString(record.status_id) ??
      coerceString(record.status),
    pipelineStatusId:
      coerceString(record.pipelineStatusId) ??
      coerceString(record.pipeline_status_id) ??
      coerceString((record as any)?.pipeline_status),
    pipelineName:
      coerceString(record.pipelineName) ??
      coerceString(record.pipeline_name) ??
      coerceString(record.pipelineTitle),
    statusName:
      coerceString(record.statusName) ??
      coerceString(record.status_name) ??
      coerceString(record.statusTitle),
    statusAliases:
      Array.isArray((record as any)?.statusAliases)
        ? ((record as any).statusAliases as unknown[])
            .map((value) => coerceString(value))
            .filter((value): value is string => Boolean(value))
        : null,
  };
};

const TIMELINE_STYLES: Record<TimelineStatus, { dot: string; border: string; title: string; text: string }> = {
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

function AutomationTimeline({ steps }: { steps: TimelineStep[] }) {
  if (!steps.length) return null;

  return (
    <ol className="space-y-3">
      {steps.map((step, index) => {
        const styles = TIMELINE_STYLES[step.status];
        return (
          <li key={step.key} className="relative ml-0 list-none pl-10">
            <span
              className={`absolute left-0 top-2 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm ${styles.dot}`}
            >
              {index + 1}
            </span>
            <div className={`rounded-xl border bg-white px-4 py-3 shadow-sm ${styles.border}`}>
              <div className={`text-sm font-semibold ${styles.title}`}>{step.title}</div>
              <div className={`mt-1 space-y-1 text-sm ${styles.text}`}>
                {step.details.map((detail, detailIndex) => (
                  <div key={`${step.key}-${detailIndex}`}>{detail}</div>
                ))}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ManychatMessageInbox() {
  const [inbox, setInbox] = useState<InboxState>({
    status: "loading",
    trace: null,
    diagnostics: null,
    automation: null,
    automationAnalysis: null,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadMessages(signal?: AbortSignal) {
      try {
        const res = await fetch("/api/mc/manychat", {
          cache: "no-store",
          signal,
        });
        const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            latest?: LatestMessage | null;
            feed?: LatestMessage[];
            messages?: LatestMessage[];
            source?: string;
            trace?: WebhookTrace | null;
            diagnostics?: Diagnostics | null;
            rawSnapshot?: RawSnapshot | null;
            requestSnapshot?: {
              rawText: string | null;
              receivedAt?: number | null;
              source?: string | null;
            } | null;
            automation?: AutomationResult | null;
            automationAnalysis?: AutomationResult | null;
          }
        | null;
      const jsonAutomationAnalysis = (json as { automationAnalysis?: AutomationResult | null } | null)?.automationAnalysis ?? null;
      if (!json || !res.ok) {
        setInbox({
          status: "error",
          message: `Помилка завантаження (${res.status})`,
          trace: json?.trace ?? null,
          diagnostics: json?.diagnostics ?? null,
          automation: (json?.automation ?? null) as AutomationResult | null,
          automationAnalysis: jsonAutomationAnalysis as AutomationResult | null,
        });
        return;
      }

      const feed = Array.isArray(json.feed)
        ? json.feed
        : Array.isArray(json.messages)
          ? json.messages
          : [] as LatestMessage[];

      const lastMessage = feed && feed.length > 0
        ? feed[0]
        : json.latest ?? null;

      const requestSnapshot: RequestSnapshot | null = json.requestSnapshot
        ? {
            rawText: json.requestSnapshot.rawText ?? null,
            receivedAt:
              typeof json.requestSnapshot.receivedAt === 'number'
                ? json.requestSnapshot.receivedAt
                : json.requestSnapshot.receivedAt
                  ? Number(json.requestSnapshot.receivedAt)
                  : null,
            source: json.requestSnapshot.source ?? null,
          }
        : null;

      setInbox({
        status: "ready",
        messages: feed,
        lastMessage,
        updatedAt: new Date(),
        source: json.source ?? null,
        trace: json.trace ?? null,
        diagnostics: json.diagnostics ?? null,
        rawSnapshot: json.rawSnapshot ?? null,
        requestSnapshot,
        automation: (json.automation ?? null) as AutomationResult | null,
        automationAnalysis: jsonAutomationAnalysis as AutomationResult | null,
      });
      } catch (err) {
        if (cancelled) return;
        if ((err as any)?.name === "AbortError") return;
        setInbox({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
          trace: null,
          diagnostics: null,
          automation: null,
          automationAnalysis: null,
        });
      }
    }

    const controller = new AbortController();
    void loadMessages(controller.signal);

    timerRef.current = setInterval(() => {
      void loadMessages();
    }, 5000);

    return () => {
      cancelled = true;
      controller.abort();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  async function refreshInbox() {
    try {
      setRefreshing(true);
      const res = await fetch("/api/mc/manychat", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            latest?: LatestMessage | null;
            feed?: LatestMessage[];
            messages?: LatestMessage[];
            source?: string;
            trace?: WebhookTrace | null;
            diagnostics?: Diagnostics | null;
            rawSnapshot?: RawSnapshot | null;
            requestSnapshot?: {
              rawText: string | null;
              receivedAt?: number | null;
              source?: string | null;
            } | null;
            automation?: AutomationResult | null;
            automationAnalysis?: AutomationResult | null;
          }
        | null;
      const jsonAutomationAnalysis = (json as { automationAnalysis?: AutomationResult | null } | null)?.automationAnalysis ?? null;
      if (!json || !res.ok) {
        setInbox({
          status: "error",
          message: `Помилка завантаження (${res.status})`,
          trace: json?.trace ?? null,
          diagnostics: json?.diagnostics ?? null,
          automation: (json?.automation ?? null) as AutomationResult | null,
          automationAnalysis: jsonAutomationAnalysis as AutomationResult | null,
        });
        return;
      }
      const feed = Array.isArray(json.feed)
        ? json.feed
        : Array.isArray(json.messages)
          ? json.messages
          : null;
      const messagesBase = feed && feed.length > 0
        ? feed
        : json.latest
          ? [json.latest]
          : [];
      const fallbackFromTrace =
        (!messagesBase || messagesBase.length === 0) && json.trace
          ? [
              {
                id: json.trace.receivedAt ?? Date.now(),
                receivedAt: json.trace.receivedAt ?? Date.now(),
                source: "trace:webhook",
                title: "ManyChat Webhook",
                handle: json.trace.handle ?? null,
                fullName: json.trace.fullName ?? null,
                text: json.trace.messagePreview ?? "",
                raw: null,
              } satisfies LatestMessage,
            ]
          : [];
      const messages = messagesBase && messagesBase.length > 0 ? messagesBase : fallbackFromTrace;
      const lastMessage =
        messages && messages.length > 0
          ? messages[0]
          : json.latest
            ? json.latest
            : fallbackFromTrace.length > 0
              ? fallbackFromTrace[0]
              : null;
      const requestSnapshot: RequestSnapshot | null = json.requestSnapshot
        ? {
            rawText: json.requestSnapshot.rawText ?? null,
            receivedAt:
              typeof json.requestSnapshot.receivedAt === "number"
                ? json.requestSnapshot.receivedAt
                : json.requestSnapshot.receivedAt
                  ? Number(json.requestSnapshot.receivedAt)
                  : null,
            source: json.requestSnapshot.source ?? null,
          }
        : null;
      setInbox({
        status: "ready",
        messages,
        lastMessage,
        updatedAt: new Date(),
        source: json.source ?? null,
        trace: json.trace ?? null,
        diagnostics: json.diagnostics ?? null,
        rawSnapshot: json.rawSnapshot ?? null,
        requestSnapshot,
        automation: (json.automation ?? null) as AutomationResult | null,
        automationAnalysis: jsonAutomationAnalysis as AutomationResult | null,
      });
    } catch (err) {
      setInbox({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        trace: null,
        diagnostics: null,
        automation: null,
        automationAnalysis: null,
      });
    } finally {
      setRefreshing(false);
    }
  }

  const trace = inbox.trace ?? null;
  const diagnostics = inbox.diagnostics ?? null;
  const apiDiag = diagnostics?.api ?? null;
  const kvConfigDiag = diagnostics?.kvConfig ?? null;
  const kvDiag = diagnostics?.kv ?? null;
  const kvTraceDiag = diagnostics?.kvTrace ?? null;
  const kvRawDiag = diagnostics?.kvRaw ?? null;
  const kvRequestDiag = diagnostics?.kvRequest ?? null;
  const kvFeedDiag = diagnostics?.kvFeed ?? null;
  const traceFallback = diagnostics?.traceFallback ?? null;
  const automationResult = inbox.status === "ready" ? inbox.automation : inbox.automation ?? null;
  const automationAnalysis =
    inbox.status === "ready" ? inbox.automationAnalysis ?? null : inbox.automationAnalysis ?? null;
  const automationPayload = automationResult ?? automationAnalysis ?? null;
  const lastMessage = inbox.status === "ready" ? inbox.lastMessage : null;
  const rawSnapshot = inbox.status === "ready" ? inbox.rawSnapshot ?? null : null;
  const requestSnapshot = inbox.status === "ready" ? inbox.requestSnapshot ?? null : null;
  const snapshotText =
    requestSnapshot?.rawText ?? rawSnapshot?.rawText ?? rawSnapshot?.text ?? null;

  const messageText = lastMessage?.text?.trim()?.length
    ? lastMessage.text
    : snapshotText?.trim()?.length
      ? snapshotText
      : null;

  const timelineSteps: TimelineStep[] = [];

  const automationErrorSource =
    automationResult && automationResult.ok === false
      ? automationResult
      : automationAnalysis && automationAnalysis.ok === false
        ? automationAnalysis
        : null;

  const automationErrorMeta = automationErrorSource
    ? describeAutomationError(automationErrorSource.error)
    : null;

  const automationErrorDetails =
    automationErrorSource && typeof automationErrorSource === "object"
      ? (automationErrorSource as { details?: unknown }).details ?? null
      : null;

  const messageStatus: TimelineStatus = trace
    ? trace.status === "accepted"
      ? "success"
      : "warning"
    : lastMessage
      ? "success"
      : "info";

  if (lastMessage || trace || messageText) {
    const details: ReactNode[] = [];
    if (lastMessage?.fullName || lastMessage?.handle) {
      details.push(
        <span key="contact">
          Контакт: {lastMessage?.fullName || "—"}
          {lastMessage?.handle ? <span className="ml-1 text-slate-500">(@{lastMessage.handle})</span> : null}
        </span>,
      );
    } else if (trace?.fullName || trace?.handle) {
      details.push(
        <span key="contact-trace">
          Контакт: {trace?.fullName || "—"}
          {trace?.handle ? <span className="ml-1 text-slate-500">(@{trace.handle})</span> : null}
        </span>,
      );
    }
    details.push(
      <span key="text">
        Текст: {messageText ?? "(порожній текст повідомлення)"}
      </span>,
    );
    details.push(
      <span key="time">
        Час: {new Date(trace?.receivedAt ?? (typeof lastMessage?.receivedAt === "number"
          ? lastMessage.receivedAt
          : typeof lastMessage?.receivedAt === "string"
            ? Number.parseInt(lastMessage.receivedAt, 10)
            : Date.now())).toLocaleString()}
      </span>,
    );
    timelineSteps.push({
      key: "message",
      title: "1. Отримане повідомлення з ManyChat",
      status: messageStatus,
      details,
    });
  } else {
    timelineSteps.push({
      key: "message",
      title: "1. Очікуємо ManyChat повідомлення",
      status: "info",
      details: [
        <span key="pending">Надішліть ключове слово в Instagram, щоб ManyChat надіслав вебхук у це середовище.</span>,
      ],
    });
  }

  if (!automationResult && !automationAnalysis) {
    timelineSteps.push(
      {
        key: "campaign",
        title: "2. Визначення кампанії",
        status: "info",
        details: [
          <span key="pending">Очікуємо запуск автоматизації після отримання вебхука.</span>,
        ],
      },
      {
        key: "card",
        title: "3. Пошук картки у KeyCRM",
        status: "info",
        details: [
          <span key="pending">Пошук картки почнеться, щойно буде підібрано кампанію.</span>,
        ],
      },
      {
        key: "move",
        title: "4. Переміщення картки",
        status: "info",
        details: [
          <span key="pending">Переміщення відбудеться автоматично після успішного пошуку картки.</span>,
        ],
      },
    );
  } else {
    const automationError = automationResult && automationResult.ok === false ? automationResult : null;
    const analysisError = automationAnalysis && automationAnalysis.ok === false ? automationAnalysis : null;
    const campaignSource =
      automationResult && automationResult.ok
        ? { result: automationResult, origin: "automation" as const }
        : automationAnalysis && automationAnalysis.ok
          ? { result: automationAnalysis, origin: "analysis" as const }
          : null;

    if (!campaignSource) {
      const errorSource = automationError ?? analysisError;
      if (errorSource) {
        const details = (errorSource.details ?? {}) as Record<string, unknown>;
        const detailsCampaign =
          details && typeof details === "object" && details.campaign && typeof details.campaign === "object"
            ? (details.campaign as Record<string, unknown>)
            : null;
        const analysisDetailsCampaign =
          analysisError && analysisError.details && typeof analysisError.details === "object"
            ? ((analysisError.details as Record<string, unknown>).campaign as Record<string, unknown> | undefined)
            : undefined;
        const errorCode = typeof errorSource.error === "string" ? errorSource.error.trim() : String(errorSource.error);

        const combinedCampaignDetails = detailsCampaign ?? analysisDetailsCampaign ?? null;

        if (errorCode.includes("keycrm_move_failed")) {
          const campaignName =
            coerceString(combinedCampaignDetails?.name) ??
            coerceString(combinedCampaignDetails?.title) ??
            coerceString(combinedCampaignDetails?.id) ??
            "(без назви)";

          const baseSummary = toTargetSummaryFromDetails(combinedCampaignDetails?.base ?? null);
          const targetSummary = toTargetSummaryFromDetails(
            combinedCampaignDetails?.target ??
              ((combinedCampaignDetails?.t1 as unknown) ??
                (combinedCampaignDetails?.t2 as unknown) ??
                null),
          );

        const detailsRecord = isRecord(details) ? details : null;
        const requestUrl =
          coerceString(detailsRecord?.requestUrl) ??
          coerceString(detailsRecord?.url) ??
          coerceString(detailsRecord?.baseUrl);
        const requestMethod = coerceString(detailsRecord?.requestMethod);
        const sentPayload = detailsRecord?.sent ?? null;
        const responsePayload = detailsRecord?.response ?? null;

        const campaignDetails: ReactNode[] = [
          <span key="move-campaign">Кампанія: {campaignName}</span>,
          <span key="move-route" className="text-xs text-emerald-700/80">
            База: {(baseSummary.pipelineName ?? baseSummary.pipelineId ?? "—")} → статус
            {baseSummary.statusName
              ? ` ${baseSummary.statusName}`
              : baseSummary.statusId
                ? ` ${baseSummary.statusId}`
                : " —"}
          </span>,
          <span key="move-target" className="text-xs text-emerald-700/80">
            Ціль: {(targetSummary.pipelineName ?? targetSummary.pipelineId ?? "—")} →
            {targetSummary.statusName
              ? ` ${targetSummary.statusName}`
              : targetSummary.statusId
                ? ` ${targetSummary.statusId}`
                : " —"}
          </span>,
        ];

        const selectedRaw =
          details && typeof details === "object" && (details.selected as Record<string, unknown> | undefined)
            ? (details.selected as Record<string, unknown>)
            : null;
        const summary = toTargetSummaryFromDetails(
          details.summary ?? (selectedRaw && "summary" in selectedRaw ? selectedRaw.summary : null),
        );
        const matchInfo =
          selectedRaw && "match" in selectedRaw && selectedRaw.match && typeof selectedRaw.match === "object"
            ? (selectedRaw.match as Record<string, unknown>)
            : null;
        const matchCardIdRaw = matchInfo?.cardId;
        const matchCardIdLabel =
          typeof matchCardIdRaw === "number"
            ? String(matchCardIdRaw)
            : coerceString(matchCardIdRaw);
        const matchCardTitle = coerceString(matchInfo?.title);
        const matchedField = coerceString(matchInfo?.matchedField);
        const matchedValue = coerceString(matchInfo?.matchedValue);

        const moveDetails: ReactNode[] = [
          <span key="move-failed">Картку знайдено, але переміщення не підтверджено (keycrm_move_failed).</span>,
        ];

        if (matchCardIdLabel) {
          moveDetails.push(
            <span key="move-card">
              Картка #{matchCardIdLabel}
              {matchCardTitle ? ` • ${matchCardTitle}` : ""}
            </span>,
          );
        }

        if (matchedField) {
          moveDetails.push(
            <span key="move-match" className="text-xs text-slate-600/80">
              Збіг за: {matchedField}
              {matchedValue ? ` → ${matchedValue}` : ""}
            </span>,
          );
        }

        if (summary) {
          const currentPipelineLabel = summary.pipelineName ?? summary.pipelineId ?? "—";
          const currentStatusLabel =
            summary.statusName ?? summary.statusId ?? summary.pipelineStatusId ?? "—";

          moveDetails.push(
            <span key="move-summary" className="text-xs text-slate-600/80">
              Поточна позиція: {currentPipelineLabel} → {currentStatusLabel}
            </span>,
          );
        }

        const attemptsArray = Array.isArray(detailsRecord?.attempts)
          ? ((detailsRecord?.attempts as unknown[]) ?? [])
          : [];
        const attempts = attemptsArray.length;
        if (attempts) {
          moveDetails.push(
            <span key="move-attempts" className="text-xs text-slate-600/80">
              Перевірок: {attempts}
            </span>,
          );
        }

        if (responsePayload) {
          moveDetails.push(
            <span key="move-response" className="text-xs text-rose-600/80">
              Відповідь: {formatJsonPreview(responsePayload)}
            </span>,
          );
        }

        timelineSteps.push(
          {
            key: "campaign",
            title: "2. Знайдена кампанія",
            status: "success",
            details: campaignDetails,
          },
          {
            key: "card",
            title: "3. Пошук картки у KeyCRM",
            status: "warning",
            details: moveDetails,
          },
          {
            key: "move",
            title: "4. Переміщення картки",
            status: "error",
            details: (
              () => {
                const moveStepDetails: ReactNode[] = [
                  <span key="error">Переміщення не вдалося: keycrm_move_failed.</span>,
                ];

                if (typeof detailsRecord?.status === "number") {
                  moveStepDetails.push(
                    <span key="status" className="text-xs text-slate-600/80">
                      HTTP статус KeyCRM: {detailsRecord.status}
                    </span>,
                  );
                }

                if (detailsRecord?.error) {
                  moveStepDetails.push(
                    <span key="error-code" className="text-xs text-rose-600/80">
                      Код помилки: {String(detailsRecord.error)}
                    </span>,
                  );
                }

                if (detailsRecord?.baseUrl) {
                  moveStepDetails.push(
                    <span key="base-url" className="text-xs text-slate-600/80">
                      Базова адреса KeyCRM:{" "}
                      <code className="break-all text-[0.7rem]">{String(detailsRecord.baseUrl)}</code>
                    </span>,
                  );
                }

                if (requestUrl || requestMethod) {
                  moveStepDetails.push(
                    <span key="request" className="text-xs text-slate-600/80">
                      URL запиту: {requestUrl ? (
                        <code className="break-all text-[0.7rem]">{requestUrl}</code>
                      ) : (
                        "н/д"
                      )}
                      {requestMethod ? <span className="ml-1">(метод {requestMethod})</span> : null}
                    </span>,
                  );
                }

                const payloadBlock = renderJsonBlock(
                  "move-error-payload",
                  "JSON запиту до KeyCRM",
                  sentPayload,
                );
                if (payloadBlock) {
                  moveStepDetails.push(payloadBlock);
                }

                const responseBlock = renderJsonBlock(
                  "move-error-response",
                  "Сира відповідь KeyCRM",
                  responsePayload,
                );
                if (responseBlock) {
                  moveStepDetails.push(responseBlock);
                }

                if (attemptsArray.length) {
                  moveStepDetails.push(
                    <div
                      key="attempts"
                      className="mt-1 space-y-1 rounded-lg border border-slate-200/70 bg-white/70 p-2 text-[0.7rem] text-slate-700"
                    >
                      <div className="font-semibold text-slate-800">Перевірки API KeyCRM:</div>
                      {attemptsArray.map((attempt, idx) => (
                        <div key={`move-error-attempt-${idx}`} className="leading-tight">
                          #{idx + 1}: {formatJsonPreview(attempt)}
                        </div>
                      ))}
                    </div>,
                  );
                }

                const detailsBlock = renderJsonBlock(
                  "move-error-details",
                  "Деталі помилки",
                  detailsRecord,
                );
                if (detailsBlock) {
                  moveStepDetails.push(detailsBlock);
                }

                return moveStepDetails;
              }
            )(),
          },
        );
        } else if (errorCode === "card_not_in_base") {
          const campaignName =
            coerceString(combinedCampaignDetails?.name) ??
            coerceString(combinedCampaignDetails?.title) ??
            coerceString(combinedCampaignDetails?.id) ??
            "(без назви)";

          const baseSummary = toTargetSummaryFromDetails(
            combinedCampaignDetails?.base ?? details.base ?? null,
          );
          const targetSummary = toTargetSummaryFromDetails(
            combinedCampaignDetails?.target ??
              (combinedCampaignDetails?.t1 as unknown) ??
              (combinedCampaignDetails?.t2 as unknown) ??
              details.target ??
              null,
          );

          const selectedSummary = toTargetSummaryFromDetails(
            details.summary ??
              ((details.selected && typeof details.selected === "object"
                ? (details.selected as Record<string, unknown>).summary
                : null) ?? null),
          );

          const mismatch = (details.mismatch ?? {}) as {
            pipelineMatches?: boolean;
            statusMatches?: boolean;
          };

          const campaignDetails: ReactNode[] = [
            <span key="campaign">Кампанія: {campaignName}</span>,
            <span key="base" className="text-xs text-emerald-700/80">
              База: {(baseSummary.pipelineName ?? baseSummary.pipelineId ?? "—")} →
              {baseSummary.statusName
                ? ` ${baseSummary.statusName}`
                : baseSummary.statusId
                  ? ` ${baseSummary.statusId}`
                  : baseSummary.pipelineStatusId
                    ? ` ${baseSummary.pipelineStatusId}`
                    : " —"}
            </span>,
            <span key="target" className="text-xs text-emerald-700/80">
              Ціль: {(targetSummary.pipelineName ?? targetSummary.pipelineId ?? "—")} →
              {targetSummary.statusName
                ? ` ${targetSummary.statusName}`
                : targetSummary.statusId
                  ? ` ${targetSummary.statusId}`
                  : targetSummary.pipelineStatusId
                    ? ` ${targetSummary.pipelineStatusId}`
                    : " —"}
            </span>,
          ];

          const cardPipelineLabel =
            selectedSummary.pipelineName ?? selectedSummary.pipelineId ?? "—";
          const cardStatusLabel =
            selectedSummary.statusName ??
            selectedSummary.statusId ??
            selectedSummary.pipelineStatusId ??
            "—";

          const cardDetails: ReactNode[] = [
            <span key="mismatch">
              Картку знайдено, але вона зараз у {cardPipelineLabel} → {cardStatusLabel}.
            </span>,
            <span key="expected" className="text-xs text-rose-600/80">
              Очікувана базова пара: {(baseSummary.pipelineName ?? baseSummary.pipelineId ?? "—")} →
              {baseSummary.statusName
                ? ` ${baseSummary.statusName}`
                : baseSummary.statusId
                  ? ` ${baseSummary.statusId}`
                  : baseSummary.pipelineStatusId
                    ? ` ${baseSummary.pipelineStatusId}`
                    : " —"}
            </span>,
          ];

          if (mismatch.pipelineMatches === false) {
            cardDetails.push(
              <span key="pipeline-mismatch" className="text-xs text-rose-600/80">
                Поточна воронка не збігається з базовою.
              </span>,
            );
          }

          if (mismatch.statusMatches === false) {
            cardDetails.push(
              <span key="status-mismatch" className="text-xs text-rose-600/80">
                Поточний статус не збігається з базовим.
              </span>,
            );
          }

          timelineSteps.push(
            {
              key: "campaign",
              title: "2. Знайдена кампанія",
              status: "success",
              details: campaignDetails,
            },
            {
              key: "card",
              title: "3. Пошук картки у KeyCRM",
              status: "error",
              details: cardDetails,
            },
            {
              key: "move",
              title: "4. Переміщення картки",
              status: "info",
              details: [
                <span key="skipped">
                  Переміщення пропущено, оскільки картка не у базовій воронці/статусі.
                </span>,
              ],
            },
          );
        } else if (combinedCampaignDetails) {
          const campaignName =
            coerceString(combinedCampaignDetails.name) ??
            coerceString(combinedCampaignDetails.title) ??
            coerceString(combinedCampaignDetails.id) ??
            "(без назви)";
          const baseSummary = toTargetSummaryFromDetails(combinedCampaignDetails.base ?? null);
          const targetSummary = toTargetSummaryFromDetails(
            combinedCampaignDetails.target ??
              (combinedCampaignDetails.t1 as unknown) ??
              (combinedCampaignDetails.t2 as unknown) ??
              null,
          );

          const campaignNotes: ReactNode[] = [
            <span key="name">Кампанія: {campaignName}</span>,
          ];
          const baseLabel =
            baseSummary.pipelineName ??
            baseSummary.pipelineId ??
            coerceString(combinedCampaignDetails.base_pipeline_name) ??
            coerceString(combinedCampaignDetails.base_pipeline_id) ??
            "—";
          const baseStatusLabel =
            baseSummary.statusName ??
            baseSummary.statusId ??
            coerceString(combinedCampaignDetails.base_status_name) ??
            coerceString(combinedCampaignDetails.base_status_id) ??
            "—";
          campaignNotes.push(
            <span key="base" className="text-xs text-emerald-700/80">
              База: {baseLabel} → статус {baseStatusLabel}
            </span>,
          );

          const targetLabel =
            targetSummary.pipelineName ??
            targetSummary.pipelineId ??
            coerceString(combinedCampaignDetails.target_pipeline_name) ??
            coerceString(combinedCampaignDetails.target_pipeline_id) ??
            coerceString(combinedCampaignDetails.v1_to_pipeline_name) ??
            coerceString(combinedCampaignDetails.v1_to_pipeline_id) ??
            coerceString(combinedCampaignDetails.v2_to_pipeline_name) ??
            coerceString(combinedCampaignDetails.v2_to_pipeline_id) ??
            "—";
          const targetStatusLabel =
            targetSummary.statusName ??
            targetSummary.statusId ??
            coerceString(combinedCampaignDetails.target_status_name) ??
            coerceString(combinedCampaignDetails.target_status_id) ??
            coerceString(combinedCampaignDetails.v1_to_status_name) ??
            coerceString(combinedCampaignDetails.v1_to_status_id) ??
            coerceString(combinedCampaignDetails.v2_to_status_name) ??
            coerceString(combinedCampaignDetails.v2_to_status_id) ??
            "—";
          campaignNotes.push(
            <span key="target" className="text-xs text-emerald-700/80">
              Ціль: {targetLabel} → {targetStatusLabel}
            </span>,
          );

          const cardDetails: ReactNode[] = [];
          let cardStatus: TimelineStatus = "warning";

          switch (errorSource.error) {
            case "card_not_found":
              cardDetails.push(
                <span key="card-missing">Картку не знайдено за обраними ідентифікаторами.</span>,
              );
              break;
            case "keycrm_search_failed":
              cardStatus = "error";
              cardDetails.push(
                <span key="search-failed">Пошук у KeyCRM завершився помилкою.</span>,
              );
              if (details.error) {
                cardDetails.push(
                  <span key="search-error" className="text-xs text-rose-600/80">
                    Деталі: {JSON.stringify(details.error)}
                  </span>,
                );
              }
              break;
            default:
              cardDetails.push(
                <span key="generic-error">Пошук картки зупинився з помилкою: {errorSource.error}.</span>,
              );
              break;
          }

          if (Array.isArray(details.attempts) && details.attempts.length) {
            cardDetails.push(
              <span key="attempts" className="text-xs text-slate-600/80">
                Спроб запиту: {details.attempts.length}
              </span>,
            );
          }

          timelineSteps.push(
            {
              key: "campaign",
              title: "2. Знайдена кампанія",
              status: "success",
              details: campaignNotes,
            },
            {
              key: "card",
              title: "3. Пошук картки у KeyCRM",
              status: cardStatus,
              details: cardDetails,
            },
            {
              key: "move",
              title: "4. Переміщення картки",
              status: "warning",
              details: [
                <span key="skipped-move">Переміщення не виконувалось через попередню помилку.</span>,
              ],
            },
          );
        } else {
          timelineSteps.push(
            {
              key: "campaign",
              title: "2. Визначення кампанії",
              status: "error",
              details: [
                <span key="error">Помилка: {errorSource.error}</span>,
                details
                  ? (
                      <span key="details" className="text-xs text-rose-600/80">
                        Деталі: {JSON.stringify(details)}
                      </span>
                    )
                  : null,
              ].filter(Boolean) as ReactNode[],
            },
            {
              key: "card",
              title: "3. Пошук картки у KeyCRM",
              status: "warning",
              details: [
                <span key="skipped">
                  {errorSource.error === "campaign_not_found" ||
                  errorSource.error === "campaign_base_missing" ||
                  errorSource.error === "campaign_target_missing"
                    ? "Пошук не виконувався через помилку під час визначення кампанії."
                    : `Пошук не виконувався через помилку автоматизації (${errorSource.error}).`}
                </span>,
              ],
            },
            {
              key: "move",
              title: "4. Переміщення картки",
              status: "warning",
              details: [
                <span key="skipped">Переміщення пропущено.</span>,
              ],
            },
          );
        }
      }
    } else {
      const sourceResult = campaignSource.result;
      const fromAutomation = campaignSource.origin === "automation";
      const campaign = sourceResult.match.campaign;
      const base = campaign.base;
      const target = campaign.target;

      const campaignNotes: ReactNode[] = [
        <span key="name">Кампанія: {campaign.name ?? "(без назви)"}</span>,
        <span key="route">Маршрут: {sourceResult.match.route.toUpperCase()} · Правило: {sourceResult.match.rule.op === "equals" ? "точний збіг" : "містить"}</span>,
        <span key="targets" className="text-xs text-emerald-700/80">
          База: {(base.pipelineName ?? base.pipelineId ?? "—")} → статус {(base.statusName ?? base.statusId ?? "—")} · Ціль: {(target.pipelineName ?? target.pipelineId ?? "—")} → {(target.statusName ?? target.statusId ?? "—")}
        </span>,
      ];

      if (!fromAutomation && automationError) {
        campaignNotes.push(
          <span key="analysis-note" className="text-xs text-amber-600/80">
            Автоматизація завершилась з помилкою: {automationError.error}. Показано аналітичний підбір кампанії.
          </span>,
        );
      }

      timelineSteps.push({
        key: "campaign",
        title: "2. Знайдена кампанія",
        status: "success",
        details: campaignNotes,
      });

      const selected = sourceResult.search.selected ?? null;
      const match = (selected as { match?: { cardId: number; title: string | null; matchedField: string; matchedValue: string | null } } | null)?.match ?? null;
      const cardSummary = selected?.summary ?? null;
      let cardStatus: TimelineStatus = match ? "success" : "warning";

      const normalizeId = (value: unknown): string | null => {
        if (typeof value === "string") {
          const trimmed = value.trim();
          return trimmed.length ? trimmed : null;
        }
        if (typeof value === "number" && Number.isFinite(value)) {
          return String(value);
        }
        return null;
      };

      const searchDetails: ReactNode[] = [];
      if (match) {
        searchDetails.push(
          <span key="card">Картка #{match.cardId}{match.title ? ` • ${match.title}` : ""}</span>,
        );
        searchDetails.push(
          <span key="field" className="text-xs text-slate-600">
            Збіг за: {match.matchedField}{match.matchedValue ? ` → ${match.matchedValue}` : ""}
          </span>,
        );
      } else {
        searchDetails.push(
          <span key="missing">Картку не знайдено. Перевірте кампанію або ключові слова.</span>,
        );
      }

      if (sourceResult.search.usedNeedle) {
        searchDetails.push(
          <span key="needle" className="text-xs text-slate-600/80">
            Використаний ідентифікатор: {sourceResult.search.usedNeedle}
          </span>,
        );
      }

      if (cardSummary) {
        const currentPipelineLabel = cardSummary.pipelineName ?? cardSummary.pipelineId ?? "—";
        const currentStatusLabel =
          cardSummary.statusName ?? cardSummary.statusId ?? cardSummary.pipelineStatusId ?? "—";

        searchDetails.push(
          <span key="summary" className="text-xs text-slate-600/80">
            Поточна позиція: {currentPipelineLabel} → {currentStatusLabel}
          </span>,
        );

        const baseStatusCandidates = [
          normalizeId(base.pipelineStatusId),
          normalizeId(base.statusId),
          ...(Array.isArray(base.statusAliases)
            ? base.statusAliases.map((alias) => normalizeId(alias))
            : []),
        ].filter((value): value is string => Boolean(value));

        const pipelineMatchesBase =
          !normalizeId(base.pipelineId) || normalizeId(base.pipelineId) === normalizeId(cardSummary.pipelineId);

        const statusMatchesBase =
          baseStatusCandidates.length === 0 ||
          baseStatusCandidates.some((candidate) =>
            candidate === normalizeId(cardSummary.pipelineStatusId) ||
            candidate === normalizeId(cardSummary.statusId),
          );

        if (!pipelineMatchesBase || !statusMatchesBase) {
          cardStatus = "error";
          const expectedPipelineLabel = base.pipelineName ?? base.pipelineId ?? "—";
          const expectedStatusLabel =
            base.statusName ?? base.statusId ?? base.pipelineStatusId ?? "—";

          searchDetails.push(
            <span key="base-mismatch" className="text-xs text-rose-600/80">
              Картка не знаходиться у базовій парі. Очікували {expectedPipelineLabel} → {expectedStatusLabel},
              а отримали {currentPipelineLabel} → {currentStatusLabel}.
            </span>,
          );
        }
      }

      if (!fromAutomation && automationError) {
        searchDetails.push(
          <span key="automation-error" className="text-xs text-amber-600/80">
            Автоматичне переміщення зупинилось з помилкою: {automationError.error}.
          </span>,
        );
      }

      timelineSteps.push({
        key: "card",
        title: "3. Пошук картки у KeyCRM",
        status: cardStatus,
        details: searchDetails,
      });

      const moveContext =
        automationResult && automationResult.ok
          ? automationResult
          : automationAnalysis && automationAnalysis.ok
            ? automationAnalysis
            : null;
      const moveOrigin: 'automation' | 'analysis' | null =
        moveContext && automationResult && automationResult.ok && moveContext === automationResult
          ? 'automation'
          : moveContext
            ? 'analysis'
            : null;
      const moveData = moveContext?.move ?? null;

      if (!moveData) {
        timelineSteps.push({
          key: "move",
          title: "4. Переміщення картки",
          status: "info",
          details: [
            <span key="pending">Автоматизація ще не запускалась у цьому середовищі — відображено лише аналітичний пошук.</span>,
          ],
        });
        timelineSteps.push({
          key: "keycrm-response",
          title: "5. Відповідь KeyCRM",
          status: "info",
          details: [
            <span key="response-missing">Відповідь KeyCRM ще не отримано.</span>,
          ],
        });
      } else if (moveContext && moveContext.ok) {
        const moveDetails: ReactNode[] = [];
        let moveStatus: TimelineStatus = moveData.ok ? "success" : "warning";

        if (moveData.attempted) {
          const targetSummary = moveContext.match?.campaign?.target ?? null;
          const baseSummary = moveContext.match?.campaign?.base ?? null;

          moveDetails.push(
            <span key="attempt">Переміщення: {moveData.ok ? "✅ успішно" : "⚠️ не підтверджено"}</span>,
          );

          if (baseSummary) {
            moveDetails.push(
              <span key="base" className="text-xs text-slate-600/80">
                Базова пара (очікували, що картка тут): {formatTargetLabel(baseSummary)}
              </span>,
            );
          }

          if (targetSummary) {
            moveDetails.push(
              <span key="target" className="text-xs text-slate-600/80">
                Цільова пара (переміщуємо сюди): {formatTargetLabel(targetSummary)}
              </span>,
            );
          }

          const payloadBlock = renderJsonBlock("payload", "JSON запиту до KeyCRM", moveData.sent);
          if (payloadBlock) {
            moveDetails.push(payloadBlock);
          } else {
            moveDetails.push(
              <span key="payload-missing" className="text-xs text-amber-600/80">
                Параметри запиту не зафіксовані — перевірте серверні логи.
              </span>,
            );
          }

          if (moveData.baseUrl) {
            moveDetails.push(
              <span key="base-url" className="text-xs text-slate-600/80">
                Базова адреса KeyCRM:{" "}
                <code className="break-all text-[0.7rem]">{moveData.baseUrl}</code>
              </span>,
            );
          }

          if (moveData.requestUrl || moveData.requestMethod) {
            moveDetails.push(
              <div key="request-url" className="text-xs text-slate-600/80">
                URL запиту: {moveData.requestUrl ? (
                  <code className="break-all text-[0.7rem]">{moveData.requestUrl}</code>
                ) : (
                  "н/д"
                )}
                {moveData.requestMethod ? (
                  <span className="ml-1 text-slate-500">(метод {moveData.requestMethod})</span>
                ) : null}
              </div>,
            );
          }

          const verificationAttempts = moveData.attempts ?? [];
          if (verificationAttempts.length) {
            const lastAttempt = verificationAttempts[verificationAttempts.length - 1];
            moveDetails.push(
              <span key="verify" className="text-xs text-slate-600/70">
                Перевірка KeyCRM: воронка {lastAttempt.pipelineMatches ? "✅" : "⚠️"} · статус {lastAttempt.statusMatches ? "✅" : "⚠️"}
              </span>,
            );
            moveDetails.push(
              <span key="snapshot" className="text-xs text-slate-600/70">
                Поточний стан картки за останньою перевіркою: {formatAttemptSnapshot(lastAttempt)}
              </span>,
            );
            moveDetails.push(
              <div
                key="attempt-list"
                className="mt-1 space-y-1 rounded-lg border border-slate-200/70 bg-white/70 p-2 text-[0.7rem] text-slate-700"
              >
                <div className="font-semibold text-slate-800">Перевірки API KeyCRM:</div>
                {verificationAttempts.map((attempt, idx) => (
                  <div key={`attempt-${idx}`} className="leading-tight">
                    #{idx + 1}: {formatAttemptSnapshot(attempt)} · воронка {attempt.pipelineMatches ? "✅" : "⚠️"} · статус {attempt.statusMatches ? "✅" : "⚠️"}
                  </div>
                ))}
              </div>,
            );
          } else {
            moveDetails.push(
              <span key="no-attempts" className="text-xs text-amber-600/80">
                KeyCRM не повернув жодної перевірки стану — запит міг завершитись помилкою до застосування змін.
              </span>,
            );
          }

          if (moveData.status) {
            moveDetails.push(
              <span key="status" className="text-xs text-slate-600/70">Код відповіді KeyCRM: {moveData.status}</span>,
            );
          }
          if (!moveData.ok && moveData.error) {
            moveDetails.push(
              <span key="error" className="text-xs text-rose-600/80">Помилка: {moveData.error}</span>,
            );
          }
          const detailsBlock = renderJsonBlock("details", "Деталі помилки", moveData.details);
          if (detailsBlock) {
            moveDetails.push(detailsBlock);
          }

          const historyEntries = extractMoveHistory(moveData.response);
          if (historyEntries.length) {
            moveDetails.push(
              <div
                key="history"
                className="mt-2 space-y-2 rounded-lg border border-emerald-100 bg-emerald-50/60 p-2 text-left text-[0.72rem] text-slate-700"
              >
                <div className="font-semibold text-emerald-800">Деталі спроб:</div>
                {historyEntries.map((entry, index) => {
                  const verificationLines = formatVerificationLines(entry.verification);
                  const sentPreview = entry.sent ? formatJsonPreview(entry.sent) : null;
                  const bodyPreview = entry.body != null ? formatJsonPreview(entry.body) : null;

                  return (
                    <div
                      key={`${entry.attempt ?? 'attempt'}-${index}`}
                      className="rounded border border-emerald-200/80 bg-white/80 p-2"
                    >
                      <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-emerald-700">
                        Спроба #{index + 1}: {entry.attempt ?? "(невідомий ендпоінт)"}
                      </div>
                      <div className="mt-1">
                        HTTP {entry.status ?? "—"} · {entry.ok ? "✅ підтверджено" : "⚠️ не підтверджено"}
                      </div>
                      {entry.error ? (
                        <div className="mt-1 text-rose-600/80">Помилка запиту: {entry.error}</div>
                      ) : null}
                      {sentPreview ? (
                        <div className="mt-1 text-slate-600">
                          Надіслано: <code className="break-all text-[0.7rem]">{sentPreview}</code>
                        </div>
                      ) : null}
                      {bodyPreview ? (
                        <div className="mt-1 text-slate-600">
                          Відповідь: <code className="break-all text-[0.7rem]">{bodyPreview}</code>
                        </div>
                      ) : null}
                      {verificationLines.length ? (
                        <div className="mt-1 space-y-1 text-slate-600">
                          <div className="font-medium text-emerald-800">Перевірки:</div>
                          {verificationLines.map((line, verifyIndex) => (
                            <div key={`verify-${index}-${verifyIndex}`} className="text-[0.7rem]">
                              {line}
                            </div>
                          ))}
                          {entry.verification && entry.verification.length > verificationLines.length ? (
                            <div className="text-[0.7rem] text-slate-500">
                              …іще {entry.verification.length - verificationLines.length} перевірок
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>,
            );
          }

          if (moveOrigin === 'analysis') {
            moveDetails.push(
              <span key="analysis-note" className="text-xs text-amber-600/80">
                Показано результати аналізу — фактична автоматизація ще не запускалась.
              </span>,
            );
          }

          timelineSteps.push({
            key: "move",
            title: "4. Переміщення картки",
            status: moveStatus,
            details: moveDetails,
          });

          const responseDetails: ReactNode[] = [];
          let responseStatus: TimelineStatus = moveData.ok
            ? "success"
            : moveData.response
              ? "warning"
              : "info";

          const responseBlock = renderJsonBlock(
            "response",
            "Сира відповідь KeyCRM",
            moveData.response,
          );

          if (responseBlock) {
            responseDetails.push(responseBlock);
          } else if (moveData.attempted) {
            responseDetails.push(
              <span key="no-response" className="text-xs text-amber-600/80">
                KeyCRM не повернув тіло відповіді — перевірте логи API.
              </span>,
            );
          } else {
            responseDetails.push(
              <span key="response-skipped" className="text-xs text-slate-600/80">
                Запит до KeyCRM не виконувався, тому відповіді немає.
              </span>,
            );
          }

          timelineSteps.push({
            key: "keycrm-response",
            title: "5. Відповідь KeyCRM",
            status: responseStatus,
            details: responseDetails,
          });
        } else if (moveData.skippedReason === "already_in_target") {
          moveStatus = "success";
          moveDetails.push(<span key="already">Картка вже була у цільовій воронці/статусі.</span>);
          timelineSteps.push({
            key: "move",
            title: "4. Переміщення картки",
            status: moveStatus,
            details: moveDetails,
          });
          timelineSteps.push({
            key: "keycrm-response",
            title: "5. Відповідь KeyCRM",
            status: "info",
            details: [
              <span key="already-response" className="text-xs text-slate-600/80">
                Відповідь KeyCRM не очікувалась, оскільки картка вже у цільовій парі.
              </span>,
            ],
          });
        } else {
          moveDetails.push(<span key="skipped">Переміщення пропущено.</span>);
          if (moveData.skippedReason) {
            moveDetails.push(
              <span key="skipped-reason" className="text-xs text-slate-600/80">
                Причина: {translateSkipReason(moveData.skippedReason)}
              </span>,
            );
          }
          timelineSteps.push({
            key: "move",
            title: "4. Переміщення картки",
            status: moveStatus,
            details: moveDetails,
          });
          timelineSteps.push({
            key: "keycrm-response",
            title: "5. Відповідь KeyCRM",
            status: "warning",
            details: [
              <span key="skipped-response" className="text-xs text-slate-600/80">
                Відповідь KeyCRM відсутня, оскільки переміщення не запускалось.
              </span>,
            ],
          });
        }
      } else {
        const moveNotes: ReactNode[] = [];
        let moveStatus: TimelineStatus = "warning";

        const automationError =
          typeof automationResult === "object" && automationResult
          && "error" in automationResult
            ? (automationResult.error as string | undefined)
            : undefined;

        if (automationError === "keycrm_move_failed") {
          moveStatus = "error";
          moveNotes.push(<span key="fail">Переміщення картки у KeyCRM не підтверджено.</span>);
        } else if (automationError) {
          moveStatus = "error";
          moveNotes.push(
            <span key="automation-error" className="text-xs text-rose-600/80">
              Автоматизація завершилась з помилкою: {automationError}
            </span>,
          );
        } else {
          moveNotes.push(<span key="skip">Переміщення не виконувалось через попередню помилку.</span>);
        }

        const automationDetails =
          typeof automationResult === "object" && automationResult && "details" in automationResult
            ? (automationResult as { details?: unknown }).details
            : undefined;

        const errorDetailsBlock = renderJsonBlock("automation-details", "Деталі помилки", automationDetails);
        if (errorDetailsBlock) {
          moveNotes.push(errorDetailsBlock);
        }

        timelineSteps.push({
          key: "move",
          title: "4. Переміщення картки",
          status: moveStatus,
          details: moveNotes,
        });
        timelineSteps.push({
          key: "keycrm-response",
          title: "5. Відповідь KeyCRM",
          status: "warning",
          details: [
            <span key="error-response" className="text-xs text-slate-600/80">
              Відповідь KeyCRM відсутня через попередню помилку автоматизації.
            </span>,
          ],
        });
      }
  }
}
  const automationMoveOutcome =
    automationResult && automationResult.ok
      ? automationResult.move.attempted
        ? automationResult.move.ok
          ? "success"
          : "failed"
          : automationResult.move.skippedReason === "already_in_target"
            ? "already"
            : "skipped"
      : null;

  if (automationErrorMeta) {
    const stepKey = STAGE_TO_STEP_KEY[automationErrorMeta.stage];
    const step = timelineSteps.find((item) => item.key === stepKey);
    const notes: ReactNode[] = [
      <span key="stage" className="text-xs text-rose-600/80">
        Автоматизація зупинилась на кроці {automationErrorMeta.step}: {automationErrorMeta.title}.
      </span>,
      <span key="module" className="text-[0.7rem] text-slate-500">
        Код: <code className="break-all">{automationErrorMeta.module}</code>
      </span>,
    ];

    if (automationErrorMeta.hint) {
      notes.push(
        <span key="hint" className="text-xs text-slate-600/80">
          Підказка: {automationErrorMeta.hint}
        </span>,
      );
    }

    if (automationErrorDetails) {
      const detailsBlock = renderJsonBlock(
        `automation-${automationErrorMeta.stage}-details`,
        "Деталі помилки",
        automationErrorDetails,
      );
      if (detailsBlock) {
        notes.push(detailsBlock);
      }
    }

    if (step) {
      step.status = "error";
      step.details = [...step.details, ...notes];
    } else {
      timelineSteps.push({
        key: stepKey,
        title: `${automationErrorMeta.step}. ${automationErrorMeta.title}`,
        status: "error",
        details: notes,
      });
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Журнал ManyChat-повідомлень</h2>
          <p className="mt-1 text-sm text-slate-500">
            Повідомлення з вебхука ManyChat автоматично з'являються у списку нижче.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshInbox}
          disabled={refreshing}
          className="inline-flex items-center justify-center rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-600 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
        >
          {refreshing ? "Оновлення…" : "Оновити"}
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <div className="rounded-2xl border border-dashed border-emerald-300/80 bg-emerald-50 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-emerald-800">Візуальна послідовність автоматизації</h3>
          <p className="mt-1 text-xs text-emerald-700/80">
            Кроки: отримуємо повідомлення з ManyChat, визначаємо кампанію, шукаємо картку в KeyCRM і переміщуємо її у ціль.
          </p>
          <div className="mt-3">
            <AutomationTimeline steps={timelineSteps} />
          </div>
        </div>
        {kvConfigDiag ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-4">
            <h3 className="text-sm font-semibold text-slate-700">Конфігурація Vercel KV</h3>
            <p className="mt-2 text-xs text-slate-500">
              URL: {kvConfigDiag.hasBaseUrl ? '✅ задано' : '⚠️ відсутній'} · Токен читання: {kvConfigDiag.hasReadToken ? '✅' : '⚠️'} · Токен запису: {kvConfigDiag.hasWriteToken ? '✅' : '⚠️'} · Кандидатів бази: {kvConfigDiag.candidates}
            </p>
          </div>
        ) : null}
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-600">Діагностика вебхука</h3>
          {trace ? (
            <div className="mt-2 space-y-1 text-sm text-slate-600">
              <p>
                Статус: {trace.status === "accepted" ? "✅ Прийнято" : "⚠️ Відхилено"}
                {trace.statusCode ? ` · Код ${trace.statusCode}` : ""}
              </p>
              <p>
                Час: {new Date(trace.receivedAt).toLocaleString()}
              </p>
              {trace.reason && <p>Деталі: {trace.reason}</p>}
              {trace.fullName || trace.handle ? (
                <p>
                  Контакт: {trace.fullName ?? "—"}
                  {trace.handle && <span className="ml-1">(@{trace.handle})</span>}
                </p>
              ) : null}
              {trace.messagePreview && <p>Текст: {trace.messagePreview}</p>}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Вебхук ще не надходив у це середовище.</p>
          )}
        </div>

        <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/60 p-4">
          <h3 className="text-sm font-semibold text-amber-700">Статус підключення ManyChat API</h3>
          {apiDiag ? (
            <p className="mt-2 text-sm text-amber-700">
              {apiDiag.ok
                ? `✅ Дані отримано (${apiDiag.note ?? "API активне"})`
                : `⚠️ ${apiDiag.message ?? "ManyChat API вимкнено"}`}
              {apiDiag.note ? (
                <span className="block text-xs text-amber-600/80">{apiDiag.note}</span>
              ) : null}
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-700/80">Очікуємо перше звернення до ManyChat API…</p>
          )}
        </div>
        <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/80 p-4">
          <h3 className="text-sm font-semibold text-emerald-700">Автоматизація ManyChat → KeyCRM</h3>
          {automationResult ? (
            automationResult.ok ? (
              <div className="mt-2 space-y-1 text-sm text-emerald-700">
                <p>
                  {automationMoveOutcome === "success"
                    ? `✅ Маршрут ${automationResult.match.route.toUpperCase()} → ${automationResult.match.campaign.name ?? 'без назви'} виконано`
                    : automationMoveOutcome === "already"
                      ? `✅ Картка вже була у цілі для маршруту ${automationResult.match.route.toUpperCase()} → ${automationResult.match.campaign.name ?? 'без назви'}`
                      : automationMoveOutcome === "skipped"
                        ? `⚠️ Маршрут ${automationResult.match.route.toUpperCase()} → ${automationResult.match.campaign.name ?? 'без назви'} виконано без переміщення`
                        : `⚠️ Маршрут ${automationResult.match.route.toUpperCase()} → ${automationResult.match.campaign.name ?? 'без назви'} не завершив переміщення`}
                </p>
                <p>
                  Ціль: {(automationResult.match.campaign.target.pipelineName || automationResult.match.campaign.target.pipelineId || '—')}
                  {automationResult.match.campaign.target.statusName || automationResult.match.campaign.target.statusId
                    ? ` · Статус: ${automationResult.match.campaign.target.statusName || automationResult.match.campaign.target.statusId}`
                    : ''}
                </p>
                <p>
                  Переміщення: {automationResult.move.attempted
                    ? automationResult.move.ok
                      ? '✅ виконано'
                      : '⚠️ не вдалося'
                    : automationResult.move.skippedReason === 'already_in_target'
                      ? '✅ картка вже у цілі'
                      : '⚠️ пропущено'}
                  {automationResult.move.error
                    ? ` · Помилка: ${automationResult.move.error}`
                    : ''}
                </p>
              </div>
            ) : (
              <div className="mt-2 text-sm text-red-600">
                ⚠️ Помилка автоматизації: {(automationResult as { ok: false; error: string }).error}
              </div>
            )
          ) : (
            <p className="mt-2 text-sm text-emerald-700/80">Автоматизація ще не запускалася для цього середовища.</p>
          )}
        </div>
        {automationPayload ? (
          <div className="rounded-xl border border-dashed border-emerald-200 bg-white/70 p-4">
            <h3 className="text-sm font-semibold text-emerald-700">Сира відповідь автоматизації</h3>
            <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-emerald-900/5 p-3 text-xs text-slate-800">
              {(() => {
                try {
                  return JSON.stringify(automationPayload, null, 2);
                } catch (error) {
                  return `<< неможливо серіалізувати: ${
                    error instanceof Error ? error.message : String(error)
                  } >>`;
                }
              })()}
            </pre>
          </div>
        ) : null}
        <div className="rounded-xl border border-dashed border-sky-200 bg-sky-50/70 p-4">
          <h3 className="text-sm font-semibold text-sky-700">Сховище повідомлень (KV)</h3>
          {kvDiag ? (
            <p className="mt-2 text-sm text-sky-700">
              {kvDiag.ok
                ? kvDiag.source === 'memory'
                  ? "✅ Останній вебхук уже в пам'яті процесу"
                  : "✅ Повідомлення знайдено у Vercel KV"
                : `⚠️ ${kvDiag.message ?? "Не вдалося отримати повідомлення з KV"}`}
              <span className="block text-xs text-sky-600/80">
                Ключ: {kvDiag.key}{kvDiag.source ? ` • джерело: ${kvDiag.source}` : ''}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-sky-700/80">Очікуємо перший запис у KV…</p>
          )}
        </div>
        {kvFeedDiag ? (
          <div className="rounded-xl border border-dashed border-emerald-200/70 bg-emerald-50/70 p-4">
            <h3 className="text-sm font-semibold text-emerald-700">Журнал повідомлень (KV)</h3>
            <p className="mt-2 text-sm text-emerald-700">
              {kvFeedDiag.ok
                ? `✅ Завантажено ${kvFeedDiag.count ?? 0} запис(ів)`
                : `⚠️ ${kvFeedDiag.message ?? 'Журнал недоступний'}`}
              <span className="block text-xs text-emerald-600/80">
                Ключ: {kvFeedDiag.key}
                {kvFeedDiag.source ? ` • джерело: ${kvFeedDiag.source}` : ''}
              </span>
            </p>
          </div>
        ) : null}
        {kvTraceDiag ? (
          <div className="rounded-xl border border-dashed border-purple-200 bg-purple-50/70 p-4">
            <h3 className="text-sm font-semibold text-purple-700">Сховище трасування (KV)</h3>
            <p className="mt-2 text-sm text-purple-700">
              {kvTraceDiag.ok
                ? "✅ Трасування вебхука знайдено"
                : kvTraceDiag.source === 'error'
                  ? `⚠️ ${kvTraceDiag.message ?? 'Помилка читання KV'}`
                  : '⚠️ Трасування не знайдено у KV'}
              <span className="block text-xs text-purple-600/80">
                Ключ: {kvTraceDiag.key}{kvTraceDiag.source ? ` • джерело: ${kvTraceDiag.source}` : ''}
              </span>
            </p>
          </div>
        ) : null}
        {kvRawDiag ? (
          <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/70 p-4">
            <h3 className="text-sm font-semibold text-amber-700">Сирий payload (KV)</h3>
            <p className="mt-2 text-sm text-amber-700">
              {kvRawDiag.ok
                ? '✅ Сирий JSON збережено у KV'
                : kvRawDiag.source === 'error'
                  ? `⚠️ ${kvRawDiag.message ?? 'Помилка читання KV'}`
                  : '⚠️ Сирий payload відсутній у KV'}
              <span className="block text-xs text-amber-600/80">
                Ключ: {kvRawDiag.key}{kvRawDiag.source ? ` • джерело: ${kvRawDiag.source}` : ''}
              </span>
            </p>
          </div>
        ) : null}
        {kvRequestDiag ? (
          <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/70 p-4">
            <h3 className="text-sm font-semibold text-blue-700">Останній сирий запит (KV)</h3>
            <p className="mt-2 text-sm text-blue-700">
              {kvRequestDiag.ok
                ? '✅ Запит збережено у KV'
                : kvRequestDiag.source === 'error'
                  ? `⚠️ ${kvRequestDiag.message ?? 'Помилка читання KV'}`
                  : '⚠️ Запит відсутній у KV'}
              <span className="block text-xs text-blue-600/80">
                Ключ: {kvRequestDiag.key}{kvRequestDiag.source ? ` • джерело: ${kvRequestDiag.source}` : ''}
              </span>
            </p>
          </div>
        ) : null}
        {traceFallback ? (
          <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/70 p-4">
            <h3 className="text-sm font-semibold text-indigo-700">Fallback із трасування</h3>
            <p className="mt-2 text-sm text-indigo-700/90">{traceFallback.reason}</p>
          </div>
        ) : null}
      </div>

      <div className="mt-6 space-y-4">
        {lastMessage ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-900">
            <h3 className="text-base font-semibold text-emerald-800">Останній вебхук ManyChat</h3>
            <p className="mt-1 text-xs text-emerald-700/80">
              {new Date(
                typeof lastMessage.receivedAt === "string"
                  ? Number.parseInt(lastMessage.receivedAt, 10)
                  : lastMessage.receivedAt ?? Date.now(),
              ).toLocaleString()} • {lastMessage.source}
            </p>
            <div className="mt-2 text-slate-700">
              <div className="font-medium">
                {lastMessage.fullName || "—"}
                {lastMessage.handle && <span className="ml-1 text-slate-500">(@{lastMessage.handle})</span>}
              </div>
              <div className="mt-1 whitespace-pre-wrap text-slate-600">
                {lastMessage.text?.trim()?.length
                  ? lastMessage.text
                  : snapshotText?.trim()?.length
                    ? snapshotText
                    : "(порожній текст повідомлення)"}
              </div>
              <div className="mt-3">
                <h4 className="text-sm font-semibold text-emerald-800">Сирий JSON вебхука</h4>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-emerald-900/5 p-3 text-xs text-emerald-900">
                  {(() => {
                    const candidateText =
                      lastMessage.rawText?.trim()?.length
                        ? lastMessage.rawText.trim()
                        : requestSnapshot?.rawText?.trim()?.length
                          ? requestSnapshot.rawText.trim()
                          : snapshotText?.trim()?.length
                            ? snapshotText.trim()
                            : null;
                    if (candidateText) {
                      try {
                        return JSON.stringify(JSON.parse(candidateText), null, 2);
                      } catch {
                        return candidateText;
                      }
                    }
                    const candidateRaw =
                      lastMessage.raw != null
                        ? lastMessage.raw
                        : rawSnapshot?.raw != null
                          ? rawSnapshot.raw
                          : null;
                    try {
                      return JSON.stringify(candidateRaw, null, 2);
                    } catch (error) {
                      return `<< неможливо серіалізувати: ${
                        error instanceof Error ? error.message : String(error)
                      } >>`;
                    }
                  })()}
                </pre>
                {requestSnapshot ? (
                  <p className="mt-2 text-xs text-emerald-700/70">
                    Збережено: {requestSnapshot.receivedAt ? new Date(requestSnapshot.receivedAt).toLocaleString() : '—'}
                    {requestSnapshot.source ? ` • джерело запиту: ${requestSnapshot.source}` : ''}
                  </p>
                ) : null}
                {rawSnapshot?.source ? (
                  <p className="mt-2 text-xs text-emerald-700/70">
                    Джерело: {rawSnapshot.source}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div>
          <h3 className="text-lg font-semibold text-slate-700">Останні повідомлення</h3>
          {inbox.status === "loading" && <p className="mt-3 text-sm text-slate-500">Завантаження…</p>}
          {inbox.status === "error" && <p className="mt-3 text-sm text-red-500">{inbox.message}</p>}
          {inbox.status === "ready" && inbox.messages.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">
              Повідомлень ще немає. Натисніть «Оновити», щойно ManyChat надішле вебхук, або перевірте діагностику вище.
            </p>
          )}
          {inbox.status === "ready" && inbox.messages.length > 0 && (
            <>
              <p className="mt-2 text-xs text-slate-400">
                Оновлено: {inbox.updatedAt.toLocaleTimeString()} (автооновлення кожні 5 секунд)
                {inbox.source && <span className="ml-1">• джерело: {inbox.source}</span>}
              </p>
              <div className="mt-3 space-y-3">
                {inbox.messages.map((message, idx) => (
                  <div key={`${message.id ?? idx}-${idx}`} className="rounded-xl border border-slate-200 p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                      <span>
                        ID:{" "}
                        {(() => {
                          if (typeof message.id === "number" && Number.isFinite(message.id)) {
                            return message.id;
                          }
                          if (typeof message.id === "string") {
                            const numeric = Number(message.id.trim());
                            if (Number.isFinite(numeric)) return numeric;
                            if (message.id.trim()) return message.id.trim();
                          }
                          return "—";
                        })()}
                      </span>
                      <span>
                        {(() => {
                          const rawTs = typeof message.receivedAt === "string"
                            ? Number(message.receivedAt.trim())
                            : message.receivedAt;
                          return typeof rawTs === "number" && Number.isFinite(rawTs)
                            ? new Date(rawTs).toLocaleString()
                            : "Невідомо";
                        })()}
                      </span>
                    </div>
                    {(message.source || message.title) && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        {message.source && <span>Джерело: {message.source}</span>}
                        {message.title && <span>Заголовок: {message.title}</span>}
                      </div>
                    )}
                    <div className="mt-2 text-slate-600">
                      <div className="font-medium text-slate-700">
                        {message.fullName || "—"}
                        {message.handle && <span className="ml-1 text-slate-500">(@{message.handle})</span>}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-slate-500">
                        {message.text?.trim()?.length
                          ? message.text
                          : snapshotText?.trim()?.length && idx === 0
                            ? snapshotText
                            : "(порожній текст повідомлення)"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
