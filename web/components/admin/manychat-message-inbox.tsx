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
      };
    }
  | { ok: false; error: string; details?: unknown };

type TargetSummary = {
  pipelineId: string | null;
  statusId: string | null;
  pipelineName: string | null;
  statusName: string | null;
};

type InboxState =
  | { status: "loading"; trace: WebhookTrace | null; diagnostics: Diagnostics | null; automation: AutomationResult | null }
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
    }
  | { status: "error"; message: string; trace: WebhookTrace | null; diagnostics: Diagnostics | null; automation: AutomationResult | null };

type TimelineStatus = "success" | "warning" | "error" | "info";

type TimelineStep = {
  key: string;
  title: string;
  status: TimelineStatus;
  details: ReactNode[];
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
  const [inbox, setInbox] = useState<InboxState>({ status: "loading", trace: null, diagnostics: null, automation: null });
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
            }
          | null;
        if (cancelled) return;
        if (!json || !res.ok) {
          setInbox({
            status: "error",
            message: `Помилка завантаження (${res.status})`,
            trace: json?.trace ?? null,
            diagnostics: json?.diagnostics ?? null,
            automation: (json?.automation ?? null) as AutomationResult | null,
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
                      rawText: null,
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
          }
        | null;
      if (!json || !res.ok) {
        setInbox({
          status: "error",
          message: `Помилка завантаження (${res.status})`,
          trace: json?.trace ?? null,
          diagnostics: json?.diagnostics ?? null,
          automation: (json?.automation ?? null) as AutomationResult | null,
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
      });
    } catch (err) {
      setInbox({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        trace: null,
        diagnostics: null,
        automation: null,
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

  if (!automationResult) {
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
  } else if (automationResult.ok === false) {
    const automationError = automationResult;
    const details = (automationError.details ?? {}) as Record<string, unknown>;
    const campaignDetails = details && typeof details === "object" ? (details.campaign as Record<string, unknown> | undefined) : undefined;

    if (campaignDetails) {
      const readTargetDisplay = (target: unknown) => {
        if (!target || typeof target !== "object") {
          return { pipeline: "—", status: "—" };
        }
        const record = target as Record<string, unknown>;
        const pipelineName = typeof record.pipelineName === "string" && record.pipelineName.trim().length
          ? record.pipelineName.trim()
          : typeof record.pipeline_name === "string" && record.pipeline_name.trim().length
            ? record.pipeline_name.trim()
            : typeof record.pipelineId === "string" && record.pipelineId.trim().length
              ? record.pipelineId.trim()
              : typeof record.pipeline_id === "string" && record.pipeline_id.trim().length
                ? record.pipeline_id.trim()
                : "—";
        const statusName = typeof record.statusName === "string" && record.statusName.trim().length
          ? record.statusName.trim()
          : typeof record.status_name === "string" && record.status_name.trim().length
            ? record.status_name.trim()
            : typeof record.statusId === "string" && record.statusId.trim().length
              ? record.statusId.trim()
              : typeof record.status_id === "string" && record.status_id.trim().length
                ? record.status_id.trim()
                : "—";
        return { pipeline: pipelineName, status: statusName };
      };

      const campaignName = (campaignDetails.name as string | undefined)?.trim() || (campaignDetails.id as string | undefined)?.trim() || "(без назви)";
      const baseInfo = readTargetDisplay(campaignDetails.base);
      const targetInfo = readTargetDisplay(campaignDetails.target);

      const campaignNotes: ReactNode[] = [
        <span key="name">Кампанія знайдена: {campaignName}</span>,
        <span key="route" className="text-xs text-emerald-700/80">
          База: {baseInfo.pipeline} → статус {baseInfo.status} · Ціль: {targetInfo.pipeline} → {targetInfo.status}
        </span>,
      ];

      if (automationError.error) {
        campaignNotes.push(
          <span key="warning" className="text-xs text-amber-600/90">
            Подальші кроки зупинено через помилку: {automationError.error}
          </span>,
        );
      }

      timelineSteps.push({
        key: "campaign",
        title: "2. Знайдена кампанія",
        status: "success",
        details: campaignNotes,
      });

      const detailsRecord = details && typeof details === "object" ? (details as Record<string, unknown>) : null;
      const searchDetails = detailsRecord && typeof detailsRecord.search === "object" ? (detailsRecord.search as Record<string, unknown>) : null;
      const selectedCandidate =
        (searchDetails?.selected as Record<string, unknown> | undefined) ??
        (detailsRecord?.selected as Record<string, unknown> | undefined) ??
        null;
      const matchCandidate = selectedCandidate && typeof selectedCandidate === "object"
        ? (selectedCandidate.match as Record<string, unknown> | undefined)
        : undefined;
      const summaryCandidate = selectedCandidate && typeof selectedCandidate === "object"
        ? (selectedCandidate.summary as Record<string, unknown> | undefined)
        : undefined;
      const attemptsCandidate = Array.isArray(searchDetails?.attempts)
        ? (searchDetails?.attempts as SearchAttempt[])
        : Array.isArray(detailsRecord?.attempts)
          ? (detailsRecord?.attempts as SearchAttempt[])
          : [];
      const usedNeedle =
        typeof searchDetails?.usedNeedle === "string"
          ? searchDetails.usedNeedle
          : typeof detailsRecord?.usedNeedle === "string"
            ? detailsRecord.usedNeedle
            : null;

      let cardStatus: TimelineStatus = matchCandidate ? "success" : attemptsCandidate.length ? "warning" : "warning";
      const cardNotes: ReactNode[] = [];

      if (matchCandidate) {
        const cardId = typeof matchCandidate.cardId === "number" ? matchCandidate.cardId : Number.parseInt(String(matchCandidate.cardId ?? "").trim(), 10);
        const cardTitle = typeof matchCandidate.title === "string" ? matchCandidate.title : null;
        cardNotes.push(
          <span key="card">
            Знайдено картку #{Number.isFinite(cardId) ? cardId : (matchCandidate.cardId as string | number | undefined)}{cardTitle ? ` • ${cardTitle}` : ""}
          </span>,
        );
        if (typeof matchCandidate.matchedField === "string") {
          cardNotes.push(
            <span key="field" className="text-xs text-slate-600">
              Збіг за: {matchCandidate.matchedField}
              {matchCandidate.matchedValue ? ` → ${matchCandidate.matchedValue}` : ""}
            </span>,
          );
        }
      } else if (automationError.error === "keycrm_move_failed" && attemptsCandidate.length) {
        cardStatus = "success";
        cardNotes.push(
          <span key="executed">Пошук виконано успішно, але переміщення картки не підтверджено.</span>,
        );
      } else {
        switch (automationError.error) {
          case "card_not_found": {
            cardNotes.push(
              <span key="missing">Картку в базовій парі не знайдено. Перевірте ключові слова або налаштування кампанії.</span>,
            );
            break;
          }
          case "keycrm_search_failed": {
            cardStatus = "error";
            cardNotes.push(
              <span key="fail">Пошук картки завершився помилкою KeyCRM.</span>,
            );
            if (detailsRecord?.error) {
              cardNotes.push(
                <span key="error" className="text-xs text-rose-600/80">
                  Деталі: {JSON.stringify(detailsRecord.error)}
                </span>,
              );
            }
            break;
          }
          case "card_match_missing": {
            cardNotes.push(
              <span key="match">KeyCRM повернув список без збігу. Спробуйте інший ідентифікатор.</span>,
            );
            break;
          }
          default: {
            cardNotes.push(
              <span key="skipped">Пошук картки завершився з попередженням ({automationError.error}).</span>,
            );
            break;
          }
        }
      }

      if (summaryCandidate) {
        const summaryPipeline =
          typeof summaryCandidate.pipelineName === "string" && summaryCandidate.pipelineName.trim().length
            ? summaryCandidate.pipelineName.trim()
            : typeof summaryCandidate.pipelineId === "string" && summaryCandidate.pipelineId.trim().length
              ? summaryCandidate.pipelineId.trim()
              : "—";
        const summaryStatus =
          typeof summaryCandidate.statusName === "string" && summaryCandidate.statusName.trim().length
            ? summaryCandidate.statusName.trim()
            : typeof summaryCandidate.statusId === "string" && summaryCandidate.statusId.trim().length
              ? summaryCandidate.statusId.trim()
              : "—";
        cardNotes.push(
          <span key="summary" className="text-xs text-slate-600/80">
            Поточна позиція: {summaryPipeline} → {summaryStatus}
          </span>,
        );
      }

      if (usedNeedle) {
        cardNotes.push(
          <span key="needle" className="text-xs text-slate-600/80">
            Використаний ідентифікатор: {usedNeedle}
          </span>,
        );
      }

      if (!cardNotes.length) {
        cardNotes.push(<span key="generic">Пошук картки не виконувався.</span>);
      }

      timelineSteps.push({
        key: "card",
        title: "3. Пошук картки у KeyCRM",
        status: cardStatus,
        details: cardNotes,
      });

      const moveNotes: ReactNode[] = [];
      let moveStatus: TimelineStatus = "warning";

      if (automationError.error === "keycrm_move_failed") {
        moveStatus = "error";
        moveNotes.push(<span key="fail">Переміщення картки у KeyCRM не підтверджено.</span>);
      } else {
        moveNotes.push(<span key="skip">Переміщення не виконувалось через попередню помилку.</span>);
      }

      timelineSteps.push({
        key: "move",
        title: "4. Переміщення картки",
        status: moveStatus,
        details: moveNotes,
      });
    } else {
      timelineSteps.push(
        {
          key: "campaign",
          title: "2. Визначення кампанії",
          status: "error",
          details: [
            <span key="error">Помилка: {automationError.error}</span>,
            automationError.details ? (
              <span key="details" className="text-xs text-rose-600/80">
                Деталі: {JSON.stringify(automationError.details)}
              </span>
            ) : null,
          ].filter(Boolean) as ReactNode[],
        },
        {
          key: "card",
          title: "3. Пошук картки у KeyCRM",
          status: "warning",
          details: [
            <span key="skipped">
              {automationError.error === "campaign_not_found" ||
              automationError.error === "campaign_base_missing" ||
              automationError.error === "campaign_target_missing"
                ? "Пошук не виконувався через помилку під час визначення кампанії."
                : `Пошук не виконувався через помилку автоматизації (${automationError.error}).`}
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
  } else {
    const automationSuccess = automationResult;
    const campaign = automationSuccess.match.campaign;
    const base = campaign.base;
    const target = campaign.target;
    timelineSteps.push({
      key: "campaign",
      title: "2. Знайдена кампанія",
      status: "success",
      details: [
        <span key="name">Кампанія: {campaign.name ?? "(без назви)"}</span>,
        <span key="route">Маршрут: {automationSuccess.match.route.toUpperCase()} · Правило: {automationSuccess.match.rule.op === "equals" ? "точний збіг" : "містить"}</span>,
        <span key="targets" className="text-xs text-emerald-700/80">
          База: {(base.pipelineName ?? base.pipelineId ?? "—")} → статус {(base.statusName ?? base.statusId ?? "—")} · Ціль: {(target.pipelineName ?? target.pipelineId ?? "—")} → {(target.statusName ?? target.statusId ?? "—")}
        </span>,
      ],
    });

    const selected = automationSuccess.search.selected ?? null;
    const match = (selected as { match?: { cardId: number; title: string | null; matchedField: string; matchedValue: string | null } } | null)?.match ?? null;
    const cardSummary = selected?.summary ?? null;
    const cardStatus: TimelineStatus = match ? "success" : "warning";

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
    if (automationSuccess.search.usedNeedle) {
      searchDetails.push(
        <span key="needle" className="text-xs text-slate-600/80">
          Використаний ідентифікатор: {automationSuccess.search.usedNeedle}
        </span>,
      );
    }
    if (cardSummary) {
      searchDetails.push(
        <span key="location" className="text-xs text-slate-600/80">
          Поточна позиція: {(cardSummary.pipelineName ?? cardSummary.pipelineId ?? "—")} → {(cardSummary.statusName ?? cardSummary.statusId ?? "—")}
        </span>,
      );
    }
    timelineSteps.push({
      key: "card",
      title: "3. Пошук картки у KeyCRM",
      status: cardStatus,
      details: searchDetails,
    });

    const move = automationSuccess.move;
    let moveStatus: TimelineStatus = "info";
    const moveDetails: ReactNode[] = [];

    if (move.attempted && move.ok) {
      moveStatus = "success";
      moveDetails.push(
        <span key="ok">Картку переміщено в цільову воронку.</span>,
      );
    } else if (!move.attempted && move.skippedReason === "already_in_target") {
      moveStatus = "success";
      moveDetails.push(
        <span key="skip-ok">Картка вже була в цільовій парі, переміщення не потрібне.</span>,
      );
    } else if (!move.attempted) {
      moveStatus = "warning";
      moveDetails.push(
        <span key="skip">Переміщення пропущено ({move.skippedReason ?? "невідома причина"}).</span>,
      );
    } else {
      moveStatus = move.ok ? "success" : "error";
      moveDetails.push(
        <span key="fail">Переміщення не вдалося.</span>,
      );
    }

    if (move.error) {
      moveDetails.push(
        <span key="error" className="text-xs text-rose-600/80">
          Помилка: {move.error}
        </span>,
      );
    }

    if (move.status) {
      moveDetails.push(
        <span key="status" className="text-xs text-slate-600/80">
          Код відповіді KeyCRM: {move.status}
        </span>,
      );
    }
    if (move.response && move.response !== true) {
      moveDetails.push(
        <span key="response" className="text-xs text-slate-600/80">
          Відповідь: {typeof move.response === "string" ? move.response : JSON.stringify(move.response)}
        </span>,
      );
    }
    if (move.sent && typeof move.sent === "object" && Object.keys(move.sent).length) {
      moveDetails.push(
        <span key="sent" className="text-xs text-slate-600/70">
          Надіслано: {JSON.stringify(move.sent)}
        </span>,
      );
    }
    if (move.attempts && move.attempts.length) {
      const lastAttempt = move.attempts[move.attempts.length - 1];
      moveDetails.push(
        <span key="verify" className="text-xs text-slate-600/70">
          Перевірка: воронка {lastAttempt.pipelineMatches ? "✅" : "⚠️"} · статус {lastAttempt.statusMatches ? "✅" : "⚠️"}
        </span>,
      );
    }

    timelineSteps.push({
      key: "move",
      title: "4. Переміщення картки",
      status: moveStatus,
      details: moveDetails,
    });
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
