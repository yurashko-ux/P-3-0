"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getFullName } from "../_components/direct-client-table-formatters";
import { InactiveBaseChatCell, type InactiveBaseClientRow } from "./_components/InactiveBaseChatCell";
import {
  readSelectedCampaignId,
  type InactiveBaseCampaign,
} from "./_components/inactive-base-campaigns-shared";

function igUrl(username: string): string {
  const u = (username || "").replace(/^@/, "").trim();
  return u ? `https://www.instagram.com/${encodeURIComponent(u)}/` : "#";
}

function phoneTelHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("380") && digits.length >= 12) return `tel:+${digits.slice(0, 12)}`;
  if (digits.startsWith("0") && digits.length >= 9) return `tel:+38${digits}`;
  if (digits.length >= 10) return `tel:+${digits}`;
  return null;
}

export default function InactiveBasePage() {
  const [clients, setClients] = useState<InactiveBaseClientRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [campaigns, setCampaigns] = useState<InactiveBaseCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "500", sortBy: "daysSinceLastVisit", sortOrder: "desc" });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/admin/direct/inactive-base/clients?${params}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setClients(Array.isArray(data.clients) ? data.clients : []);
      setTotalCount(Number(data.totalCount ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/direct/inactive-base/campaigns", { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.ok && Array.isArray(data.items)) {
        setCampaigns(data.items);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    const syncSelected = () => {
      setSelectedCampaignId(readSelectedCampaignId());
    };
    syncSelected();
    window.addEventListener("inactive-base:campaign-selected", syncSelected);
    window.addEventListener("storage", syncSelected);
    return () => {
      window.removeEventListener("inactive-base:campaign-selected", syncSelected);
      window.removeEventListener("storage", syncSelected);
    };
  }, []);

  useEffect(() => {
    const handler = () => void loadClients();
    window.addEventListener("inactive-base:reload-clients", handler);
    return () => window.removeEventListener("inactive-base:reload-clients", handler);
  }, [loadClients]);

  const allVisibleSelected = clients.length > 0 && clients.every((c) => selectedIds.has(c.id));
  const someSelected = selectedIds.size > 0;

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(clients.map((c) => c.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sendPhoneToTelegram = async (clientId: string) => {
    try {
      const res = await fetch(`/api/admin/direct/clients/${encodeURIComponent(clientId)}/send-phone-to-telegram`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        alert(typeof data?.error === "string" ? data.error : "Не вдалося надіслати номер у Telegram");
        return;
      }
      alert("Номер клієнта відправлено в Telegram адміністратора");
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const copyCampaignTexts = async () => {
    if (!selectedCampaignId) {
      alert("Оберіть кампанію у вікні «Кампанії» (клік по назві в списку)");
      return;
    }
    const campaign = campaigns.find((c) => c.id === selectedCampaignId);
    if (!campaign) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      alert("Оберіть клієнтів");
      return;
    }
    const lines: string[] = [];
    for (const id of ids) {
      const c = clients.find((x) => x.id === id);
      if (!c) continue;
      const name = getFullName(c as Parameters<typeof getFullName>[0]);
      const body = campaign.bodyTemplate
        .replace(/\{\{\s*ПІБ\s*\}\}/gi, name)
        .replace(/\{\{\s*імя\s*\}\}/gi, c.firstName || name)
        .replace(/\{\{\s*прізвище\s*\}\}/gi, c.lastName || "");
      lines.push(`${name} (@${c.instagramUsername.replace(/^@/, "")})\n${body}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n\n---\n\n"));
      alert(`Скопійовано ${lines.length} текстів для ручної відправки`);
    } catch {
      alert("Не вдалося скопіювати");
    }
  };

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="w-full max-w-[calc(100vw-32px)] mx-auto">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Link href="/admin/direct" className="btn btn-sm btn-ghost">
            ← Direct
          </Link>
          <Link href="/admin/direct/stats" className="btn btn-sm btn-ghost" target="_blank" rel="noopener noreferrer">
            📈 Статистика
          </Link>
          <h1 className="text-lg font-semibold">Не Активна база</h1>
          <span className="text-xs text-base-content/70">
            {totalCount} клієнтів · відстежуємо відповіді Inst і Telegram (без автовідправки)
          </span>
          <Link
            href="/admin/direct/inactive-base/campaigns"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm btn-outline ml-auto"
          >
            Кампанії
          </Link>
        </div>

        <div className="bg-base-100 rounded-lg border border-base-300 p-3 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs block mb-1">Пошук</label>
            <input
              className="input input-bordered input-sm w-48"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ПІБ, Instagram, телефон"
            />
          </div>
          <button type="button" className="btn btn-sm" disabled={loading} onClick={() => void loadClients()}>
            {loading ? "…" : "Оновити"}
          </button>
          {someSelected && selectedCampaignId ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copyCampaignTexts()}>
              Скопіювати тексти кампанії ({selectedIds.size})
            </button>
          ) : null}
        </div>

        {error && (
          <div className="alert alert-error text-sm mb-3">
            <span>{error}</span>
            <button type="button" className="btn btn-xs" onClick={() => void loadClients()}>
              Повторити
            </button>
          </div>
        )}

        <div className="bg-base-100 rounded-lg border border-base-300 overflow-x-auto">
          <table className="table table-sm table-zebra">
            <thead>
              <tr className="text-[10px]">
                <th className="w-8">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs"
                    checked={allVisibleSelected}
                    title="Обрати всі на сторінці"
                    onChange={toggleAllVisible}
                  />
                </th>
                <th className="w-10">№</th>
                <th>ПІБ</th>
                <th>Instagram</th>
                <th>Inst</th>
                <th>Telegram</th>
                <th>Телефон</th>
                <th className="text-right">Днів</th>
              </tr>
            </thead>
            <tbody>
              {loading && clients.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-sm opacity-70">
                    Завантаження…
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-sm opacity-70">
                    Немає клієнтів у неактивній базі
                  </td>
                </tr>
              ) : (
                clients.map((client, index) => {
                  const fullName = getFullName(client as Parameters<typeof getFullName>[0]);
                  return (
                    <tr key={client.id} className={selectedIds.has(client.id) ? "bg-primary/5" : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={selectedIds.has(client.id)}
                          onChange={() => toggleOne(client.id)}
                        />
                      </td>
                      <td className="tabular-nums text-xs">{index + 1}</td>
                      <td className="text-xs whitespace-nowrap max-w-[200px] truncate" title={fullName}>
                        {fullName}
                      </td>
                      <td className="text-xs">
                        <a
                          href={igUrl(client.instagramUsername)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link link-primary"
                        >
                          @{client.instagramUsername.replace(/^@/, "")}
                        </a>
                      </td>
                      <td className="text-xs">
                        <InactiveBaseChatCell client={client} channel="instagram" />
                      </td>
                      <td className="text-xs">
                        <InactiveBaseChatCell
                          client={client}
                          channel="telegram"
                          key={`${client.id}-tg`}
                        />
                      </td>
                      <td className="text-xs whitespace-nowrap">
                        <div className="flex items-center gap-1 min-w-0">
                          {client.phone ? (
                            (() => {
                              const tel = phoneTelHref(client.phone);
                              return tel ? (
                                <a href={tel} className="link link-hover font-mono truncate max-w-[120px]" title={client.phone}>
                                  {client.phone}
                                </a>
                              ) : (
                                <span className="font-mono truncate max-w-[120px]" title={client.phone}>
                                  {client.phone}
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-base-content/40">—</span>
                          )}
                          {client.phone ? (
                            <button
                              type="button"
                              className="inline-flex h-6 shrink-0 items-center justify-center rounded-md px-0.5 text-base hover:bg-black/5"
                              title="Надіслати телефон клієнта в Telegram адміністратора"
                              onClick={() => void sendPhoneToTelegram(client.id)}
                            >
                              📞
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-xs text-right tabular-nums">
                        {typeof client.daysSinceLastVisit === "number" ? client.daysSinceLastVisit : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-base-content/60 mt-2">
          Inst і Telegram — той самий механізм, що в Direct: лічильник, голубий = нові / без статусу, історія та статус
          переписки. Telegram: вхідні з business-акаунта салону зберігаються автоматично (потрібен webhook HOB_client_bot).
          Автоматична розсилка вимкнена — тексти кампаній лише для копіювання вручну.
        </p>
      </div>

    </div>
  );
}
