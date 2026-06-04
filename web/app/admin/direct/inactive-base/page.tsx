"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatDateDDMMYY, getFullName } from "../_components/direct-client-table-formatters";
import { InactiveBaseChatCell, type InactiveBaseClientRow } from "./_components/InactiveBaseChatCell";
import { buildDisplayRows } from "./_components/inactive-base-table-rows";
import {
  INACTIVE_BASE_CAMPAIGNS_CHANGED_EVENT,
  readSelectedCampaignId,
  writePendingCampaignClientIds,
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

export type InactiveBaseSortField =
  | "name"
  | "instagramUsername"
  | "messagesTotal"
  | "telegramMessagesTotal"
  | "phone"
  | "daysSinceLastVisit";

type SortOrder = "asc" | "desc";

function SortableTh({
  label,
  field,
  sortBy,
  sortOrder,
  onSort,
  className = "",
}: {
  label: string;
  field: InactiveBaseSortField;
  sortBy: InactiveBaseSortField;
  sortOrder: SortOrder;
  onSort: (field: InactiveBaseSortField) => void;
  className?: string;
}) {
  const active = sortBy === field;
  return (
    <th className={className}>
      <button
        type="button"
        className={`hover:underline cursor-pointer text-left font-semibold ${
          active ? "text-primary" : "text-inherit"
        }`}
        onClick={() => onSort(field)}
      >
        {label}
        {active ? (sortOrder === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

type CampaignFilterMeta = { id: string; name: string } | null;

function InactiveBasePageContent() {
  const searchParams = useSearchParams();
  const campaignIdFromUrl = searchParams.get("campaignId")?.trim() || "";

  const [clients, setClients] = useState<InactiveBaseClientRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [campaigns, setCampaigns] = useState<InactiveBaseCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<InactiveBaseSortField>("daysSinceLastVisit");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [showCampaignColumn, setShowCampaignColumn] = useState(false);
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilterMeta>(null);
  const [expandedCampaignIds, setExpandedCampaignIds] = useState<Set<string>>(new Set());
  /** Індекс останнього кліку по чекбоксу — для виділення діапазону з Shift */
  const lastCheckboxIndexRef = useRef<number | null>(null);

  const enableCampaignGrouping = !campaignFilter;
  const displayRows = useMemo(
    () => buildDisplayRows(clients, expandedCampaignIds, enableCampaignGrouping),
    [clients, expandedCampaignIds, enableCampaignGrouping]
  );

  const tableColSpan = showCampaignColumn ? 9 : 8;

  const toggleCampaignExpand = (campaignId: string) => {
    setExpandedCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
  };

  const handleSort = (field: InactiveBaseSortField) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  const loadClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: "500",
        sortBy,
        sortOrder,
      });
      if (search.trim()) params.set("search", search.trim());
      if (campaignIdFromUrl) params.set("campaignId", campaignIdFromUrl);
      const res = await fetch(`/api/admin/direct/inactive-base/clients?${params}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setClients(Array.isArray(data.clients) ? data.clients : []);
      setTotalCount(Number(data.totalCount ?? 0));
      setShowCampaignColumn(Boolean(data.showCampaignColumn));
      setCampaignFilter(
        data.campaignFilter && typeof data.campaignFilter === "object"
          ? { id: String(data.campaignFilter.id), name: String(data.campaignFilter.name) }
          : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [search, sortBy, sortOrder, campaignIdFromUrl]);

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
    window.addEventListener(INACTIVE_BASE_CAMPAIGNS_CHANGED_EVENT, handler);
    return () => {
      window.removeEventListener("inactive-base:reload-clients", handler);
      window.removeEventListener(INACTIVE_BASE_CAMPAIGNS_CHANGED_EVENT, handler);
    };
  }, [loadClients]);

  const canCreateCampaign = selectedIds.size > 0;

  const openCreateCampaign = () => {
    if (!canCreateCampaign) return;
    writePendingCampaignClientIds(Array.from(selectedIds));
    window.open("/admin/direct/inactive-base/campaigns?new=1", "_blank", "noopener,noreferrer");
  };

  const allVisibleSelected =
    displayRows.length > 0 && displayRows.every((r) => selectedIds.has(r.client.id));
  const someSelected = selectedIds.size > 0;

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
      lastCheckboxIndexRef.current = null;
    } else {
      setSelectedIds(new Set(displayRows.map((r) => r.client.id)));
      lastCheckboxIndexRef.current = displayRows.length > 0 ? displayRows.length - 1 : null;
    }
  };

  const handleRowCheckbox = (index: number, id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    const shift = (e.nativeEvent as MouseEvent).shiftKey;

    if (shift && lastCheckboxIndexRef.current !== null) {
      const from = Math.min(lastCheckboxIndexRef.current, index);
      const to = Math.max(lastCheckboxIndexRef.current, index);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) {
          const rowId = displayRows[i]?.client.id;
          if (!rowId) continue;
          if (checked) next.add(rowId);
          else next.delete(rowId);
        }
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (checked) next.add(id);
        else next.delete(id);
        return next;
      });
    }
    lastCheckboxIndexRef.current = index;
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
          <button
            type="button"
            className={`btn btn-sm btn-primary ${canCreateCampaign ? "" : "btn-disabled opacity-40"}`}
            disabled={!canCreateCampaign}
            aria-disabled={!canCreateCampaign}
            title={
              canCreateCampaign
                ? `Створити кампанію для ${selectedIds.size} клієнтів`
                : "Спочатку виділіть клієнтів чекбоксами в таблиці"
            }
            onClick={() => openCreateCampaign()}
          >
            Створити кампанію{canCreateCampaign ? ` (${selectedIds.size})` : ""}
          </button>
          {someSelected && selectedCampaignId ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copyCampaignTexts()}>
              Скопіювати тексти кампанії ({selectedIds.size})
            </button>
          ) : null}
        </div>

        {campaignFilter ? (
          <div className="alert alert-info text-sm mb-3 py-2 flex flex-wrap items-center gap-2">
            <span>
              Кампанія «{campaignFilter.name}» — {totalCount} клієнтів
            </span>
            <Link href="/admin/direct/inactive-base" className="btn btn-xs btn-ghost">
              Уся неактивна база
            </Link>
          </div>
        ) : null}

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
                <SortableTh
                  label="№"
                  field="name"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                  className="w-10"
                />
                <SortableTh label="ПІБ" field="name" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                {showCampaignColumn ? <th className="text-[10px] font-semibold min-w-[100px]">Кампанії</th> : null}
                <SortableTh
                  label="Instagram"
                  field="instagramUsername"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortableTh
                  label="Inst"
                  field="messagesTotal"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortableTh
                  label="Telegram"
                  field="telegramMessagesTotal"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortableTh label="Телефон" field="phone" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <SortableTh
                  label="Днів"
                  field="daysSinceLastVisit"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                  className="text-right"
                />
              </tr>
            </thead>
            <tbody>
              {loading && clients.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="text-center py-8 text-sm opacity-70">
                    Завантаження…
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="text-center py-8 text-sm opacity-70">
                    Немає клієнтів у неактивній базі
                  </td>
                </tr>
              ) : (
                displayRows.map((row, index) => {
                  const client = row.client;
                  const fullName = getFullName(client as Parameters<typeof getFullName>[0]);
                  const isMember = row.kind === "campaignMember";
                  const isLeader = row.kind === "campaignLeader";
                  const inCampaignGroup = isLeader || isMember;
                  const expanded = isLeader && expandedCampaignIds.has(row.campaignId);
                  const nextRow = displayRows[index + 1];
                  const isLastInExpandedGroup =
                    isMember &&
                    (!nextRow ||
                      nextRow.kind !== "campaignMember" ||
                      (nextRow.kind === "campaignMember" && nextRow.campaignId !== row.campaignId));
                  const isCollapsedGroupEnd =
                    isLeader && !expanded && (row.memberCount ?? 1) >= 1;

                  const rowBg = selectedIds.has(client.id)
                    ? "!bg-sky-100"
                    : inCampaignGroup
                      ? "!bg-sky-50"
                      : "";

                  const rowBorder = [
                    expanded && isLeader ? "border-t-2 border-sky-300" : "",
                    isLastInExpandedGroup || isCollapsedGroupEnd ? "border-b-[3px] border-sky-400" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <tr
                      key={`${row.kind}-${client.id}-${index}`}
                      className={[rowBg, rowBorder].filter(Boolean).join(" ") || undefined}
                    >
                      <td>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={selectedIds.has(client.id)}
                          title="Shift+клік — виділити діапазон від попередньої галочки"
                          onChange={(e) => handleRowCheckbox(index, client.id, e)}
                        />
                      </td>
                      <td className="tabular-nums text-xs">
                        {isLeader ? (
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              className="btn btn-xs btn-ghost px-0 min-h-0 h-5 w-5 shrink-0"
                              aria-expanded={expanded}
                              title={expanded ? "Згорнути групу" : "Розгорнути групу"}
                              onClick={() => toggleCampaignExpand(row.campaignId)}
                            >
                              {expanded ? "▼" : "▶"}
                            </button>
                            <span>{index + 1}</span>
                          </div>
                        ) : (
                          <span className={isMember ? "pl-5 inline-block" : ""}>{index + 1}</span>
                        )}
                      </td>
                      <td
                        className={`text-xs whitespace-nowrap max-w-[200px] truncate ${isMember ? "pl-4" : ""}`}
                        title={fullName}
                      >
                        {fullName}
                      </td>
                      {showCampaignColumn ? (
                        <td className="text-xs max-w-[140px]">
                          {client.lastCampaign ? (
                            <div className="leading-tight" title={client.lastCampaign.name}>
                              <div className="text-[10px] text-base-content/60 tabular-nums">
                                {formatDateDDMMYY(client.lastCampaign.at)}
                              </div>
                              <div className="truncate font-medium">
                                {client.lastCampaign.name}
                                {isLeader && row.memberCount > 1 ? (
                                  <span className="text-primary font-normal ml-1">
                                    (+{row.memberCount - 1})
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <span className="text-base-content/40">—</span>
                          )}
                        </td>
                      ) : null}
                      <td className={`text-xs ${isMember ? "pl-4" : ""}`}>
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
                        <InactiveBaseChatCell client={client} channel="telegram" key={`${client.id}-tg`} />
                      </td>
                      <td className={`text-xs whitespace-nowrap ${isMember ? "pl-4" : ""}`}>
                        <div className="flex items-center gap-1 min-w-0">
                          {client.phone ? (
                            (() => {
                              const tel = phoneTelHref(client.phone);
                              return tel ? (
                                <a
                                  href={tel}
                                  className="link link-hover font-mono truncate max-w-[120px]"
                                  title={client.phone}
                                >
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
          {enableCampaignGrouping
            ? "▶/▼ — згорнути або розгорнути групу кампанії. Клієнти з однією (останньою) кампанією згруповані під першим рядком. "
            : null}
          Виділення: Shift+клік між чекбоксами. Inst і Telegram — як у Direct. Автоматична розсилка вимкнена.
        </p>
      </div>

    </div>
  );
}

export default function InactiveBasePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-base-200 flex items-center justify-center text-sm opacity-70 p-4">
          Завантаження…
        </div>
      }
    >
      <InactiveBasePageContent />
    </Suspense>
  );
}
