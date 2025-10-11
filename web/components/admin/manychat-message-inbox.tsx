"use client";

import { useEffect, useRef, useState } from "react";

import type { ManychatTestMessage } from "@/app/api/admin/test/manychat/messages/route";

type InboxState =
  | { status: "loading" }
  | { status: "ready"; items: ManychatTestMessage[]; updatedAt: Date }
  | { status: "error"; message: string };

export function ManychatMessageInbox() {
  const [inbox, setInbox] = useState<InboxState>({ status: "loading" });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMessages(signal?: AbortSignal) {
      try {
        const res = await fetch("/api/admin/test/manychat/messages", {
          cache: "no-store",
          signal,
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; items?: ManychatTestMessage[] }
          | null;
        if (cancelled) return;
        if (!json || !res.ok) {
          setInbox({ status: "error", message: `Помилка завантаження (${res.status})` });
          return;
        }
        const items = Array.isArray(json.items) ? json.items : [];
        setInbox({ status: "ready", items, updatedAt: new Date() });
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
      const res = await fetch("/api/admin/test/manychat/messages", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; items?: ManychatTestMessage[] }
        | null;
      if (!json || !res.ok) {
        setInbox({ status: "error", message: `Помилка завантаження (${res.status})` });
        return;
      }
      const items = Array.isArray(json.items) ? json.items : [];
      setInbox({ status: "ready", items, updatedAt: new Date() });
    } catch (err) {
      setInbox({ status: "error", message: err instanceof Error ? err.message : String(err) });
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
          className="inline-flex items-center justify-center rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-600"
        >
          Оновити
        </button>
      </div>

      <div className="mt-6">
        <h3 className="text-lg font-semibold text-slate-700">Останні повідомлення</h3>
        {inbox.status === "loading" && <p className="mt-3 text-sm text-slate-500">Завантаження…</p>}
        {inbox.status === "error" && <p className="mt-3 text-sm text-red-500">{inbox.message}</p>}
        {inbox.status === "ready" && inbox.items.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">Повідомлень ще немає.</p>
        )}
        {inbox.status === "ready" && inbox.items.length > 0 && (
          <>
            <p className="mt-2 text-xs text-slate-400">
              Оновлено: {inbox.updatedAt.toLocaleTimeString()} (автооновлення кожні 5 секунд)
            </p>
            <ul className="mt-3 space-y-3">
              {inbox.items.map((item) => (
                <li key={item.id} className="rounded-xl border border-slate-200 p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                    <span>ID: {item.id}</span>
                    <span>{new Date(item.receivedAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 text-slate-600">
                    <div className="font-medium text-slate-700">
                      {item.fullName || "—"}
                      {item.username && <span className="ml-1 text-slate-500">({item.username})</span>}
                      {item.handle && !item.username && (
                        <span className="ml-1 text-slate-500">(@{item.handle})</span>
                      )}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-slate-500">{item.text}</div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
