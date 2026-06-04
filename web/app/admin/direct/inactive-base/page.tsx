"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatDateDDMMYY, getFullName } from "../_components/direct-client-table-formatters";
import { InactiveBaseChatCell, type InactiveBaseClientRow } from "./_components/InactiveBaseChatCell";
import {
  INACTIVE_BASE_CAMPAIGNS_CHANGED_EVENT,
  buildDirectClientsUrl,
  readSelectedCampaignId,
  writePendingCampaignClientIds,
  type InactiveBaseCampaign,
} from "./_components/inactive-base-campaigns-shared";
import {
  buildDisplayRows,
  collectClientIdsForCampaign,
  expandSelectedClientIds,
  isDisplayRowChecked,
  type DisplayRow,
} from "./_components/inactive-base-table-rows";

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

  const canTransferToCampaign =
    someSelected && campaigns.length > 0 && Boolean(transferTargetCampaignId);

  const transferToCampaign = async () => {
    if (!canTransferToCampaign) return;
    const ids = effectiveActionClientIds;
    setTransferring(true);
    try {
      const res = await fetch(
        `/api/admin/direct/inactive-base/campaigns/${encodeURIComponent(transferTargetCampaignId)}/transfer`,
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
      setSelectedCampaignGroupId(data.campaignId ?? transferTargetCampaignId);
      await loadClients();
      void loadCampaigns();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setTransferring(false);
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
          {showCampaignColumn && campaigns.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="text-xs block mb-1">Кампанія (група)</label>
                <select
                  className="select select-bordered select-sm min-w-[160px]"
                  value={transferTargetCampaignId}
                  disabled={!someSelected}
                  title={
                    someSelected
                      ? "Оберіть кампанію для перенесення виділених клієнтів"
                      : "Спочатку виділіть клієнтів чекбоксами"
                  }
                  onChange={(e) => setTransferTargetCampaignId(e.target.value)}
                >
                  <option value="">— оберіть —</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {typeof c.clientCount === "number" ? ` (${c.clientCount})` : ""}
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
                    ? `Перенести ${effectiveActionClientIds.length} клієнтів у обрану кампанію`
                    : "Виділіть клієнтів і оберіть кампанію"
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
                          checked={rowChecked}
                          title={
                            isLeader && !expanded && row.kind === "campaignLeader"
                              ? `Обрати всю групу (${row.memberCount} клієнтів). Shift+клік — діапазон`
                              : "Shift+клік — виділити діапазон від попередньої галочки"
                          }
                          onChange={(e) => handleRowCheckbox(index, row, e)}
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
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCampaignExpand(row.campaignId);
                              }}
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
                              {isLeader ? (
                                <button
                                  type="button"
                                  className="truncate font-medium link link-primary hover:underline block text-left w-full"
                                  title={`Обрати групу (${row.memberCount} клієнтів) — «В Direct» відкриє всю групу`}
                                  onClick={() => selectCampaignGroup(row.campaignId)}
                                >
                                  {client.lastCampaign.name}
                                </button>
                              ) : (
                                <div className="truncate font-medium">{client.lastCampaign.name}</div>
                              )}
                              {isLeader ? (
                                <button
                                  type="button"
                                  className="text-[11px] text-primary font-medium tabular-nums text-left hover:underline"
                                  onClick={() => selectCampaignGroup(row.campaignId)}
                                >
                                  {row.memberCount} клієнтів
                                </button>
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
            ? "▶/▼ — згорнути/розгорнути групу. Галочка згорнутого рядка — уся група; розгорнутого лідера — лише цей клієнт. "
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
