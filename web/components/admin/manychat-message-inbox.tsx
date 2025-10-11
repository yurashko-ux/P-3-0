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

type InboxState =
  | { status: "loading" }
  | { status: "ready"; message: LatestMessage | null; updatedAt: Date }
  | { status: "error"; message: string };

export function ManychatMessageInbox() {
  const [inbox, setInbox] = useState<InboxState>({ status: "loading" });
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
          | { ok?: boolean; latest?: LatestMessage | null }
          | null;
        if (cancelled) return;
        if (!json || !res.ok) {
          setInbox({ status: "error", message: `Помилка завантаження (${res.status})` });
          return;
        }
        setInbox({ status: "ready", message: json.latest ?? null, updatedAt: new Date() });
      } catch (err) {
        if (cancelled) return;
        if ((err as any)?.name === "AbortError") return;
        setInbox({ status: "error", message: err instanceof Error ? err.message : String(err) });
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
        | { ok?: boolean; latest?: LatestMessage | null }
        | null;
      if (!json || !res.ok) {
        setInbox({ status: "error", message: `Помилка завантаження (${res.status})` });
        return;
      }
      setInbox({ status: "ready", message: json.latest ?? null, updatedAt: new Date() });
    } catch (err) {
      setInbox({ status: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRefreshing(false);
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

      <div className="mt-6">
        <h3 className="text-lg font-semibold text-slate-700">Останні повідомлення</h3>
        {inbox.status === "loading" && <p className="mt-3 text-sm text-slate-500">Завантаження…</p>}
        {inbox.status === "error" && <p className="mt-3 text-sm text-red-500">{inbox.message}</p>}
        {inbox.status === "ready" && !inbox.message && (
          <p className="mt-3 text-sm text-slate-500">Повідомлень ще немає.</p>
        )}
        {inbox.status === "ready" && inbox.message && (
          <>
            <p className="mt-2 text-xs text-slate-400">
              Оновлено: {inbox.updatedAt.toLocaleTimeString()} (автооновлення кожні 5 секунд)
            </p>
            <div className="mt-3 space-y-3">
              <div className="rounded-xl border border-slate-200 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span>
                    ID:{" "}
                    {(() => {
                      if (typeof inbox.message.id === "number" && Number.isFinite(inbox.message.id)) {
                        return inbox.message.id;
                      }
                      if (typeof inbox.message.id === "string") {
                        const numeric = Number(inbox.message.id.trim());
                        if (Number.isFinite(numeric)) return numeric;
                        if (inbox.message.id.trim()) return inbox.message.id.trim();
                      }
                      return "—";
                    })()}
                  </span>
                  <span>
                    {(() => {
                      const rawTs = typeof inbox.message.receivedAt === "string"
                        ? Number(inbox.message.receivedAt.trim())
                        : inbox.message.receivedAt;
                      return typeof rawTs === "number" && Number.isFinite(rawTs)
                        ? new Date(rawTs).toLocaleString()
                        : "Невідомо";
                    })()}
                  </span>
                </div>
                {(inbox.message.source || inbox.message.title) && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    {inbox.message.source && <span>Джерело: {inbox.message.source}</span>}
                    {inbox.message.title && <span>Заголовок: {inbox.message.title}</span>}
                  </div>
                )}
                <div className="mt-2 text-slate-600">
                  <div className="font-medium text-slate-700">
                    {inbox.message.fullName || "—"}
                    {inbox.message.handle && (
                      <span className="ml-1 text-slate-500">(@{inbox.message.handle})</span>
                    )}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-slate-500">{inbox.message.text || ""}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
