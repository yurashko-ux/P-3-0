"use client";

import { useEffect, useRef, useState } from "react";

type LatestMessage = {
  id: number | string | null;
  receivedAt: number | string | null;
  source: string;
  title: string;
  handle: string | null;
  fullName: string | null;
  text: string;
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
    url?: string;
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
};

type InboxState =
  | { status: "loading"; trace: WebhookTrace | null; diagnostics: Diagnostics | null }
  | {
      status: "ready";
      messages: LatestMessage[];
      updatedAt: Date;
      source: string | null;
      trace: WebhookTrace | null;
      diagnostics: Diagnostics | null;
    }
  | { status: "error"; message: string; trace: WebhookTrace | null; diagnostics: Diagnostics | null };

export function ManychatMessageInbox() {
  const [inbox, setInbox] = useState<InboxState>({ status: "loading", trace: null, diagnostics: null });
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
              source?: string;
              trace?: WebhookTrace | null;
              diagnostics?: Diagnostics | null;
            }
          | null;
        if (cancelled) return;
        if (!json || !res.ok) {
          setInbox({
            status: "error",
            message: `Помилка завантаження (${res.status})`,
            trace: json?.trace ?? null,
            diagnostics: json?.diagnostics ?? null,
          });
          return;
        }
        setInbox({
          status: "ready",
          messages: Array.isArray(json.feed) ? json.feed : json.latest ? [json.latest] : [],
          updatedAt: new Date(),
          source: json.source ?? null,
          trace: json.trace ?? null,
          diagnostics: json.diagnostics ?? null,
        });
      } catch (err) {
        if (cancelled) return;
        if ((err as any)?.name === "AbortError") return;
        setInbox({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
          trace: null,
          diagnostics: null,
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
            source?: string;
            trace?: WebhookTrace | null;
            diagnostics?: Diagnostics | null;
          }
        | null;
      if (!json || !res.ok) {
        setInbox({
          status: "error",
          message: `Помилка завантаження (${res.status})`,
          trace: json?.trace ?? null,
          diagnostics: json?.diagnostics ?? null,
        });
        return;
      }
      setInbox({
        status: "ready",
        messages: Array.isArray(json.feed) ? json.feed : json.latest ? [json.latest] : [],
        updatedAt: new Date(),
        source: json.source ?? null,
        trace: json.trace ?? null,
        diagnostics: json.diagnostics ?? null,
      });
    } catch (err) {
      setInbox({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        trace: null,
        diagnostics: null,
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
  const kvFeedDiag = diagnostics?.kvFeed ?? null;
  const traceFallback = diagnostics?.traceFallback ?? null;

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
                ? `✅ Дані отримано (${apiDiag.note === "empty" ? "повідомлення відсутні" : "є нові повідомлення"})`
                : `⚠️ ${apiDiag.message ?? "Не вдалося отримати дані"}`}
              {apiDiag.url ? (
                <span className="block text-xs text-amber-600/80">
                  Джерело: {apiDiag.url}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-700/80">Очікуємо перше звернення до ManyChat API…</p>
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
        {traceFallback ? (
          <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/70 p-4">
            <h3 className="text-sm font-semibold text-indigo-700">Fallback із трасування</h3>
            <p className="mt-2 text-sm text-indigo-700/90">{traceFallback.reason}</p>
          </div>
        ) : null}
      </div>

      <div className="mt-6">
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
                    <div className="mt-1 whitespace-pre-wrap text-slate-500">{message.text || ""}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
