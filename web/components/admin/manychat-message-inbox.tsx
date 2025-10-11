"use client";

import { useEffect, useState } from "react";

import type { ManychatTestMessage } from "@/app/api/admin/test/manychat/messages/route";

type InboxState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: ManychatTestMessage[] }
  | { status: "error"; message: string };

type SubmitState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "error"; message: string }
  | { status: "success" };

export function ManychatMessageInbox() {
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [text, setText] = useState("");
  const [inbox, setInbox] = useState<InboxState>({ status: "idle" });
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setInbox({ status: "loading" });
      try {
        const res = await fetch("/api/admin/test/manychat/messages", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; items?: ManychatTestMessage[] } | null;
        if (cancelled) return;
        if (!json || !res.ok) {
          setInbox({ status: "error", message: `Помилка завантаження (${res.status})` });
          return;
        }
        const items = Array.isArray(json.items) ? json.items : [];
        setInbox({ status: "ready", items });
      } catch (err) {
        if (cancelled) return;
        setInbox({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshInbox() {
    try {
      const res = await fetch("/api/admin/test/manychat/messages", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; items?: ManychatTestMessage[] } | null;
      if (!json || !res.ok) {
        setInbox({ status: "error", message: `Помилка завантаження (${res.status})` });
        return;
      }
      const items = Array.isArray(json.items) ? json.items : [];
      setInbox({ status: "ready", items });
    } catch (err) {
      setInbox({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) {
      setSubmit({ status: "error", message: "Введіть текст повідомлення" });
      return;
    }
    setSubmit({ status: "sending" });
    try {
      const res = await fetch("/api/admin/test/manychat/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            username: username.trim() || undefined,
            full_name: fullName.trim() || undefined,
            text: text.trim(),
          },
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (!json || !res.ok || json.ok === false) {
        setSubmit({ status: "error", message: `Помилка збереження (${res.status})` });
        return;
      }
      setSubmit({ status: "success" });
      setText("");
      await refreshInbox();
    } catch (err) {
      setSubmit({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const isSending = submit.status === "sending";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold text-slate-800">Журнал ManyChat-повідомлень</h2>
      <p className="mt-2 text-sm text-slate-500">
        Надішліть payload з ManyChat (username, ім'я, текст) і перегляньте останні повідомлення безпосередньо тут.
      </p>

      <form onSubmit={onSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-600">Username (опційно)</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none"
            placeholder="@username"
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-600">Повне ім'я (опційно)</span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none"
            placeholder="Ім'я Прізвище"
            autoComplete="off"
          />
        </label>
        <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-600">Текст повідомлення</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="h-24 rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none"
            placeholder="Введіть текст"
          />
        </label>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
            disabled={isSending}
          >
            {isSending ? "Надсилаємо…" : "Зберегти повідомлення"}
          </button>
          {submit.status === "error" && <span className="text-sm text-red-500">{submit.message}</span>}
          {submit.status === "success" && <span className="text-sm text-emerald-600">Готово!</span>}
        </div>
      </form>

      <div className="mt-6">
        <h3 className="text-lg font-semibold text-slate-700">Останні повідомлення</h3>
        {inbox.status === "loading" && <p className="mt-3 text-sm text-slate-500">Завантаження…</p>}
        {inbox.status === "error" && (
          <p className="mt-3 text-sm text-red-500">{inbox.message}</p>
        )}
        {inbox.status === "ready" && inbox.items.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">Повідомлень ще немає.</p>
        )}
        {inbox.status === "ready" && inbox.items.length > 0 && (
          <ul className="mt-3 space-y-3">
            {inbox.items.map((item) => (
              <li key={item.id} className="rounded-xl border border-slate-200 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span>ID: {item.id}</span>
                  <span>{new Date(item.receivedAt).toLocaleString()}</span>
                </div>
                <div className="mt-2 text-slate-600">
                  <div className="font-medium text-slate-700">
                    {item.fullName || "—"} {item.username ? `(${item.username})` : ""}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-slate-500">{item.text}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
