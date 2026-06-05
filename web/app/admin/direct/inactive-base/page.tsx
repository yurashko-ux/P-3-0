"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatDateDDMMYY, getFullName } from "../_components/direct-client-table-formatters";
import { InactiveBaseChatCell, type InactiveBaseClientRow } from "./_components/InactiveBaseChatCell";
import {
  INACTIVE_BASE_CAMPAIGNS_CHANGED_EVENT,
  INACTIVE_BASE_TRANSFER_NO_GROUP,
  buildDirectClientsUrl,
  buildInactiveBaseCampaignsUrl,
  readSelectedCampaignId,
  writePendingCampaignClientIds,
  type InactiveBaseCampaign,
} from "./_components/inactive-base-campaigns-shared";
import {
  assignDisplayRowNumbers,
  buildDisplayRows,
  collectClientIdsForCampaign,
  expandSelectedClientIds,
  isDisplayRowChecked,
  type DisplayRow,
} from "./_components/inactive-base-table-rows";
import { InactiveBaseTelegramFilterDropdown } from "./_components/InactiveBaseTelegramFilterDropdown";
import type {
  TelegramCanSendCounts,
  TelegramCanSendFilterValue,
} from "@/lib/inactive-base/telegram-can-send-filter";

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
  const [selectedCampaignGroupId, setSelectedCampaignGroupId] = useState<string | null>(null);
  /** Галочка лідера згорнутої групи = усі клієнти кампанії */
  const [selectedCollapsedGroupIds, setSelectedCollapsedGroupIds] = useState<Set<string>>(new Set());
  const [transferTargetCampaignId, setTransferTargetCampaignId] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [ensureName, setEnsureName] = useState("Юрашко Микола");
  const [ensuring, setEnsuring] = useState(false);
  const [telegramCanSendFilter, setTelegramCanSendFilter] = useState<TelegramCanSendFilterValue[]>(
    []
  );
  const [telegramCanSendCounts, setTelegramCanSendCounts] = useState<TelegramCanSendCounts | null>(
    null
  );
  /** Індекс останнього кліку по чекбоксу — для виділення діапазону з Shift */
  const lastCheckboxIndexRef = useRef<number | null>(null);

  const enableCampaignGrouping = !campaignFilter;
  const displayRows = useMemo(
    () => buildDisplayRows(clients, expandedCampaignIds, enableCampaignGrouping),
    [clients, expandedCampaignIds, enableCampaignGrouping]
  );
  const numberedDisplayRows = useMemo(
    () => assignDisplayRowNumbers(displayRows),
    [displayRows]
  );

  const tableColSpan = showCampaignColumn ? 9 : 8;

  const toggleCampaignExpand = (campaignId: string) => {
    setExpandedCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(campaignId)) {
        next.delete(campaignId);
      } else {
        next.add(campaignId);
        setSelectedCollapsedGroupIds((collapsed) => {
          const c = new Set(collapsed);
          c.delete(campaignId);
          return c;
        });
      }
      return next;
    });
  };

  /** Обрати всю групу кампанії (без чекбоксів) — для «В Direct» усіх учасників групи. */
  const selectCampaignGroup = (campaignId: string) => {
    setSelectedCampaignGroupId(campaignId);
    setTransferTargetCampaignId(campaignId);
    setSelectedIds(new Set());
    setSelectedCollapsedGroupIds(new Set());
    lastCheckboxIndexRef.current = null;
  };

  const selectedGroupClientIds = selectedCampaignGroupId
    ? collectClientIdsForCampaign(clients, selectedCampaignGroupId)
    : [];
  const selectedGroupName =
    selectedCampaignGroupId &&
    clients.find((c) => c.lastCampaign?.campaignId === selectedCampaignGroupId)?.lastCampaign?.name;

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
      if (telegramCanSendFilter.length) params.set("telegramCanSend", telegramCanSendFilter.join(","));
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
      if (data.telegramCanSendCounts && typeof data.telegramCanSendCounts === "object") {
        setTelegramCanSendCounts({
          can: Number(data.telegramCanSendCounts.can ?? 0),
          cannot: Number(data.telegramCanSendCounts.cannot ?? 0),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [search, sortBy, sortOrder, campaignIdFromUrl, telegramCanSendFilter]);

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

  const expandedSelectedClientIds = useMemo(
    () => expandSelectedClientIds(clients, selectedIds, selectedCollapsedGroupIds),
    [clients, selectedIds, selectedCollapsedGroupIds]
  );

  const hasCheckboxSelection =
    selectedIds.size > 0 || selectedCollapsedGroupIds.size > 0;

  const effectiveActionClientIds = useMemo(() => {
    if (expandedSelectedClientIds.length > 0) return expandedSelectedClientIds;
    if (selectedCampaignGroupId) {
      return collectClientIdsForCampaign(clients, selectedCampaignGroupId);
    }
    return [];
  }, [expandedSelectedClientIds, selectedCampaignGroupId, clients]);

  const canCreateCampaign = effectiveActionClientIds.length > 0;

  const openCreateCampaign = () => {
    if (!canCreateCampaign) return;
    writePendingCampaignClientIds(effectiveActionClientIds);
    window.open("/admin/direct/inactive-base/campaigns?new=1", "_blank", "noopener,noreferrer");
  };

  const allVisibleSelected =
    displayRows.length > 0 &&
    displayRows.every((r) =>
      isDisplayRowChecked(r, expandedCampaignIds, selectedIds, selectedCollapsedGroupIds)
    );
  const someSelected = hasCheckboxSelection;

  const clearCampaignGroupSelection = () => {
    setSelectedCampaignGroupId(null);
  };

  /** Галочки — обрані клієнти/групи; інакше клік по назві кампанії — уся група. */
  const directClientIds = hasCheckboxSelection
    ? expandedSelectedClientIds
    : selectedGroupClientIds;
  const directLabel = hasCheckboxSelection
    ? `${directClientIds.length} клієнтів`
    : selectedGroupName || "Кампанія";
  const canOpenInDirect =
    enableCampaignGrouping && !campaignFilter && directClientIds.length > 0;

  const openDirectInNewWindow = () => {
    if (!canOpenInDirect) return;
    const path = buildDirectClientsUrl(directClientIds, directLabel);
    const url = path.startsWith("http") ? path : `${window.location.origin}${path}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const applyCheckboxToRow = (row: DisplayRow, checked: boolean) => {
    if (row.kind === "campaignLeader" && !expandedCampaignIds.has(row.campaignId)) {
      setSelectedCollapsedGroupIds((prev) => {
        const next = new Set(prev);
        if (checked) next.add(row.campaignId);
        else next.delete(row.campaignId);
        return next;
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(row.client.id);
        return next;
      });
      return;
    }
    if (row.kind === "campaignLeader") {
      setSelectedCollapsedGroupIds((prev) => {
        const next = new Set(prev);
        next.delete(row.campaignId);
        return next;
      });
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(row.client.id);
      else next.delete(row.client.id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
      setSelectedCollapsedGroupIds(new Set());
      clearCampaignGroupSelection();
      lastCheckboxIndexRef.current = null;
    } else {
      clearCampaignGroupSelection();
      const nextClientIds = new Set<string>();
      const nextCollapsed = new Set<string>();
      for (const row of displayRows) {
        if (row.kind === "campaignLeader" && !expandedCampaignIds.has(row.campaignId)) {
          nextCollapsed.add(row.campaignId);
        } else {
          nextClientIds.add(row.client.id);
        }
      }
      setSelectedIds(nextClientIds);
      setSelectedCollapsedGroupIds(nextCollapsed);
      lastCheckboxIndexRef.current = displayRows.length > 0 ? displayRows.length - 1 : null;
    }
  };

  const handleRowCheckbox = (index: number, row: DisplayRow, e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    const shift = (e.nativeEvent as MouseEvent).shiftKey;
    clearCampaignGroupSelection();

    if (shift && lastCheckboxIndexRef.current !== null) {
      const from = Math.min(lastCheckboxIndexRef.current, index);
      const to = Math.max(lastCheckboxIndexRef.current, index);
      for (let i = from; i <= to; i++) {
        const rangeRow = displayRows[i];
        if (!rangeRow) continue;
        applyCheckboxToRow(rangeRow, checked);
      }
    } else {
      applyCheckboxToRow(row, checked);
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

  const canTransferToCampaign = someSelected && Boolean(transferTargetCampaignId);
  const transferTargetIsNoGroup = transferTargetCampaignId === INACTIVE_BASE_TRANSFER_NO_GROUP;

  const transferToCampaign = async () => {
    if (!canTransferToCampaign) return;
    const ids = effectiveActionClientIds;
    setTransferring(true);
    try {
      const res = await fetch(
        transferTargetIsNoGroup
          ? "/api/admin/direct/inactive-base/campaigns/remove-from-group"
          : `/api/admin/direct/inactive-base/campaigns/${encodeURIComponent(transferTargetCampaignId)}/transfer`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientIds: ids }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Помилка перенесення");
      setSelectedIds(new Set());
      setSelectedCollapsedGroupIds(new Set());
      if (transferTargetIsNoGroup) {
        setSelectedCampaignGroupId(null);
      } else {
        setSelectedCampaignGroupId(data.campaignId ?? transferTargetCampaignId);
      }
      await loadClients();
      void loadCampaigns();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setTransferring(false);
    }
  };

  const ensureClientInInactiveBase = async () => {
    const name = ensureName.trim();
    if (!name) {
      alert("Вкажіть ПІБ клієнта з Direct");
      return;
    }
    setEnsuring(true);
    try {
      const body: Record<string, string> = { name };
      if (campaignIdFromUrl) body.campaignId = campaignIdFromUrl;
      const res = await fetch("/api/admin/direct/inactive-base/clients/ensure", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (Array.isArray(data.matches) && data.matches.length > 0) {
          const list = data.matches
            .map((m: { id: string; name?: string; instagramUsername?: string }) =>
              `${m.name || m.instagramUsername || m.id} (${m.id})`
            )
            .join("\n");
          alert(`${data.error || "Помилка"}\n\n${list}`);
        } else {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        return;
      }
      const q = (data.displayName as string) || name;
      setSearch(q.split(/\s+/)[0] ?? q);
      alert(data.message || "Готово");
      void loadClients();
      void loadCampaigns();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setEnsuring(false);
    }
  };

  const copyCampaignTexts = async () => {
    if (!selectedCampaignId) {
      alert("Оберіть кампанію у вікні «Кампанії» (клік по назві в списку)");
      return;
    }
    const campaign = campaigns.find((c) => c.id === selectedCampaignId);
    if (!campaign) return;
    const ids = effectiveActionClientIds;
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
        <div className="bg-base-100 rounded-lg border border-base-300 p-3 mb-3 flex flex-wrap gap-3 items-end">
          <Link href="/admin/direct" className="btn btn-sm btn-ghost shrink-0">
            ← Direct
          </Link>
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
          <div>
            <label className="text-xs block mb-1" title="Клієнт має бути в Direct; дата візиту зсувається на 110+ днів назад">
              Додати в базу (ПІБ)
            </label>
            <div className="flex gap-1">
              <input
                className="input input-bordered input-sm w-40"
                value={ensureName}
                onChange={(e) => setEnsureName(e.target.value)}
                placeholder="Прізвище Імʼя"
              />
              <button
                type="button"
                className="btn btn-sm btn-outline"
                disabled={ensuring || loading}
                title="Знайти в Direct і показати в неактивній базі"
                onClick={() => void ensureClientInInactiveBase()}
              >
                {ensuring ? "…" : "Додати"}
              </button>
            </div>
          </div>
          {showCampaignColumn ? (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="text-xs block mb-1">Кампанія (група)</label>
                <select
                  className="select select-bordered select-sm min-w-[160px]"
                  value={transferTargetCampaignId}
                  disabled={!someSelected}
                  title={
                    someSelected
                      ? "Оберіть групу для перенесення або «Немає групи» для вилучення"
                      : "Спочатку виділіть клієнтів чекбоксами"
                  }
                  onChange={(e) => setTransferTargetCampaignId(e.target.value)}
                >
                  <option value="">— оберіть —</option>
                  <option value={INACTIVE_BASE_TRANSFER_NO_GROUP}>Немає групи</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {typeof c.clientCount === "number"
                        ? ` (${c.clientCount}/${c.respondedCount ?? 0})`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className={`btn btn-sm btn-outline ${canTransferToCampaign ? "" : "btn-disabled opacity-40"}`}
                disabled={!canTransferToCampaign || transferring}
                title={
                  canTransferToCampaign
                    ? transferTargetIsNoGroup
                      ? `Вилучити ${effectiveActionClientIds.length} клієнтів з групи`
                      : `Перенести ${effectiveActionClientIds.length} клієнтів у обрану групу`
                    : "Виділіть клієнтів і оберіть групу в списку"
                }
                onClick={() => void transferToCampaign()}
              >
                {transferring ? "…" : "Перенести"}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className={`btn btn-sm btn-primary ${canCreateCampaign ? "" : "btn-disabled opacity-40"}`}
            disabled={!canCreateCampaign}
            aria-disabled={!canCreateCampaign}
            title={
              canCreateCampaign
                ? `Створити кампанію для ${effectiveActionClientIds.length} клієнтів`
                : "Спочатку виділіть клієнтів чекбоксами в таблиці"
            }
            onClick={() => openCreateCampaign()}
          >
            Створити кампанію{canCreateCampaign ? ` (${effectiveActionClientIds.length})` : ""}
          </button>
          <div className="flex flex-wrap items-end gap-2 ml-auto shrink-0">
            {enableCampaignGrouping ? (
              canOpenInDirect ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  title={
                    hasCheckboxSelection
                      ? `Відкрити ${directClientIds.length} виділених клієнтів у Direct (нове вікно)`
                      : `Відкрити всю групу «${selectedGroupName || "Кампанія"}» (${directClientIds.length}) у Direct (нове вікно)`
                  }
                  onClick={openDirectInNewWindow}
                >
                  В Direct ({directClientIds.length})
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-disabled opacity-40"
                  disabled
                  title="Виділіть клієнтів чекбоксами або клікніть по назві кампанії / «N клієнтів» у рядку групи"
                >
                  В Direct
                </button>
              )
            ) : null}
            <Link
              href="/admin/direct/inactive-base/campaigns"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm btn-outline"
            >
              Кампанії
            </Link>
          </div>
          {someSelected && selectedCampaignId ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copyCampaignTexts()}>
              Скопіювати тексти кампанії ({effectiveActionClientIds.length})
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
                <th>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className={`hover:underline cursor-pointer text-left font-semibold text-[10px] ${
                        sortBy === "telegramMessagesTotal" ? "text-primary" : "text-inherit"
                      }`}
                      onClick={() => handleSort("telegramMessagesTotal")}
                    >
                      Telegram
                      {sortBy === "telegramMessagesTotal" ? (sortOrder === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                    <InactiveBaseTelegramFilterDropdown
                      value={telegramCanSendFilter}
                      onChange={setTelegramCanSendFilter}
                      counts={telegramCanSendCounts}
                    />
                  </div>
                </th>
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
                numberedDisplayRows.map((row, index) => {
                  const client = row.client;
                  const fullName = getFullName(client as Parameters<typeof getFullName>[0]);
                  const isMember = row.kind === "campaignMember";
                  const isLeader = row.kind === "campaignLeader";
                  const inCampaignGroup = isLeader || isMember;
                  const expanded = isLeader && expandedCampaignIds.has(row.campaignId);
                  const nextRow = numberedDisplayRows[index + 1];
                  const rowCampaignId =
                    row.kind === "campaignLeader" || row.kind === "campaignMember"
                      ? row.campaignId
                      : null;
                  const isExpandedGroupEnd =
                    rowCampaignId != null &&
                    expandedCampaignIds.has(rowCampaignId) &&
                    (!nextRow ||
                      nextRow.kind !== "campaignMember" ||
                      (nextRow.kind === "campaignMember" && nextRow.campaignId !== rowCampaignId));
                  const isInsideExpandedGroup =
                    rowCampaignId != null && expandedCampaignIds.has(rowCampaignId);
                  const isGroupSelected =
                    !hasCheckboxSelection && isLeader && selectedCampaignGroupId === row.campaignId;
                  const rowChecked = isDisplayRowChecked(
                    row,
                    expandedCampaignIds,
                    selectedIds,
                    selectedCollapsedGroupIds
                  );

                  const rowBg = rowChecked
                    ? "!bg-sky-100"
                    : isGroupSelected
                      ? "!bg-sky-100/80"
                      : inCampaignGroup
                        ? "!bg-sky-50"
                        : "";

                  const rowBorder = [
                    expanded && isLeader ? "border-t-2 border-sky-300" : "",
                    isExpandedGroupEnd ? "border-b-[3px] border-sky-400" : "",
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
                          checked={rowChecked}
                          title={
                            isLeader && !expanded && row.kind === "campaignLeader"
                              ? `Обрати всю групу (${row.memberCount} клієнтів). Shift+клік — діапазон`
                              : "Shift+клік — виділити діапазон від попередньої галочки"
                          }
                          onChange={(e) => handleRowCheckbox(index, row, e)}
                        />
                      </td>
                      <td className="tabular-nums text-xs align-middle min-w-0 max-w-[280px]">
                        {isLeader && row.kind === "campaignLeader" ? (
                          <div className="flex items-center gap-1 min-w-0 whitespace-nowrap overflow-hidden">
                            <span className="font-semibold text-base-content shrink-0">{row.groupNumber}</span>
                            <button
                              type="button"
                              className="btn btn-xs btn-ghost px-0 min-h-0 h-5 w-5 shrink-0"
                              aria-expanded={expanded}
                              title={expanded ? "Згорнути групу" : "Розгорнути групу"}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCampaignExpand(row.campaignId);
                              }}
                            >
                              {expanded ? "▼" : "▶"}
                            </button>
                            <button
                              type="button"
                              className="text-[11px] text-primary font-medium tabular-nums shrink-0 hover:underline"
                              title={`Обрати групу (${row.memberCount} клієнтів)`}
                              onClick={() => selectCampaignGroup(row.campaignId)}
                            >
                              {row.memberCount} клієнтів
                            </button>
                            <Link
                              href={buildInactiveBaseCampaignsUrl(row.campaignId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate font-medium link link-primary hover:underline min-w-0 shrink"
                              title={`Відкрити кампанію «${row.campaignName}»`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {row.campaignName}
                            </Link>
                          </div>
                        ) : isMember ? (
                          <span className="pl-5 inline-block tabular-nums">{row.clientNumberInGroup}</span>
                        ) : (
                          <span className="tabular-nums">{row.soloNumber}</span>
                        )}
                      </td>
                      <td
                        className={`text-xs whitespace-nowrap max-w-[200px] truncate ${isMember || (isLeader && expanded) ? "pl-4" : ""}`}
                        title={fullName}
                      >
                        <Link
                          href={buildDirectClientsUrl([client.id], fullName)}
                          className="link link-hover"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {fullName}
                        </Link>
                      </td>
                      {showCampaignColumn ? (
                        <td className="text-xs max-w-[140px]">
                          {client.lastCampaign ? (
                            <div className="leading-tight" title={client.lastCampaign.name}>
                              <div className="text-[10px] text-base-content/60 tabular-nums">
                                {formatDateDDMMYY(client.lastCampaign.at)}
                              </div>
                              {!isInsideExpandedGroup ? (
                                <div className="truncate font-medium">{client.lastCampaign.name}</div>
                              ) : null}
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
            ? "▶/▼ — згорнути/розгорнути групу. Перенести: виділіть клієнтів і групу в списку (або «Немає групи»). "
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
