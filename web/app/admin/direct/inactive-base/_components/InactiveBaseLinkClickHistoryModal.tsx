"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getFullName } from "../../_components/direct-client-table-formatters";

export type LinkClickHistoryRow = {
  id: string;
  clickedAt: string;
  campaignId: string;
  campaignName: string;
  linkLabel: string | null;
  linkUrl: string | null;
  messageBody: string;
  legacyAggregated?: boolean;
  legacyClickCount?: number;
};

type Props = {
  client: { id: string; firstName: string | null; lastName: string | null; instagramUsername: string } | null;
  isOpen: boolean;
  onClose: () => void;
};

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function renderMessageWithLink(body: string, linkLabel: string | null) {
  const label = (linkLabel || "").trim();
  if (!label || !body.includes(label)) {
    return <span className="whitespace-pre-wrap">{body}</span>;
  }
  const idx = body.indexOf(label);
  const before = body.slice(0, idx);
  const after = body.slice(idx + label.length);
  return (
    <span className="whitespace-pre-wrap">
      {before}
      <span className="link link-primary font-medium">{label}</span>
      {after}
    </span>
  );
}

export function InactiveBaseLinkClickHistoryModal({ client, isOpen, onClose }: Props) {
  const [items, setItems] = useState<LinkClickHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    if (!client?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/direct/inactive-base/clients/${encodeURIComponent(client.id)}/link-clicks`,
        { credentials: "include", cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Помилка завантаження");
      const rows = Array.isArray(data.items) ? data.items : [];
      setItems(rows);
      if (rows.length === 0 && data.meta?.hint) {
        setError(String(data.meta.hint));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [client?.id]);

  useEffect(() => {
    if (isOpen && client?.id) void load();
  }, [isOpen, client?.id, load]);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!mounted || !isOpen || !client) return null;

  const fullName = getFullName(client as Parameters<typeof getFullName>[0]);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-gray-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="link-click-history-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 shrink-0 bg-white rounded-t-lg">
          <div className="min-w-0">
            <h3 id="link-click-history-title" className="font-bold text-base text-slate-900">
              Історія переходів по посиланнях
            </h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {fullName} · @{client.instagramUsername.replace(/^@/, "")}
            </p>
          </div>
          <button
            type="button"
            className="text-gray-500 hover:text-gray-700 shrink-0 text-lg leading-none"
            onClick={onClose}
            aria-label="Закрити"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0 bg-white">
          {loading ? (
            <p className="text-sm text-center py-8 text-gray-500">Завантаження…</p>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <button type="button" className="btn btn-xs" onClick={() => void load()}>
                Повторити
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-center py-8 text-gray-500">Переходів по посиланнях ще немає</p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.id} className="border border-gray-200 rounded-lg p-3 text-sm bg-white">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                    <span className="font-medium text-primary">{item.campaignName}</span>
                    <span className="text-xs tabular-nums text-gray-500 whitespace-nowrap">
                      {formatDateTime(item.clickedAt)}
                      {item.legacyAggregated && item.legacyClickCount && item.legacyClickCount > 1
                        ? ` · ${item.legacyClickCount} переходів (агреговано)`
                        : null}
                    </span>
                  </div>
                  <div className="text-xs text-slate-800 bg-gray-100 rounded-md p-2.5 leading-relaxed">
                    {renderMessageWithLink(item.messageBody, item.linkLabel)}
                  </div>
                  {item.linkUrl ? (
                    <p className="text-[10px] text-gray-400 mt-2 truncate" title={item.linkUrl}>
                      URL: {item.linkUrl}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-200 px-4 py-3 shrink-0 flex justify-end bg-white rounded-b-lg">
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Закрити
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
