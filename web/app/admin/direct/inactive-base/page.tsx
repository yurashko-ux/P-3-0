"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  parseInactiveBaseView,
  type InactiveBaseView,
} from "@/lib/inactive-base/consultation-base-client";
import type { DirectClient } from "@/lib/direct-types";
import { BinotelCallHistoryModal } from "../_components/BinotelCallHistoryModal";
import { InlineCallRecordingPlayer } from "../_components/InlineCallRecordingPlayer";
import { formatDateDDMMYY, getFullName } from "../_components/direct-client-table-formatters";
import { InactiveBaseCallStatusCell } from "./_components/InactiveBaseCallStatusCell";
import { InactiveBaseCallsCell } from "./_components/InactiveBaseCallsCell";
import { InactiveBaseCampaignAudienceBadges } from "./_components/InactiveBaseCampaignAudienceBadges";
import { InactiveBaseChatCell, type InactiveBaseClientRow } from "./_components/InactiveBaseChatCell";
import { inactiveBaseRowToDirectClient } from "./_components/inactive-base-direct-client";
import { InactiveBaseInstagramUsernameCell } from "./_components/InactiveBaseInstagramUsernameCell";
import { InactiveBaseLinkClickCell } from "./_components/InactiveBaseLinkClickCell";
import { InactiveBaseLinkClickHistoryModal } from "./_components/InactiveBaseLinkClickHistoryModal";
import { InactiveBaseMessageStatusCell } from "./_components/InactiveBaseMessageStatusCell";
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
  computeCampaignAudienceCountsByCampaignId,
  computeCampaignBinotelTotalCallCounts,
  computeCampaignInstagramActiveClientCounts,
  computeCampaignLinkClickedClientCounts,
  computeCampaignTelegramActiveClientCounts,
  expandSelectedClientIds,
  isDisplayRowChecked,
  type DisplayRow,
} from "./_components/inactive-base-table-rows";
import { InactiveBaseInstagramFilterDropdown } from "./_components/InactiveBaseInstagramFilterDropdown";
import { InactiveBaseTelegramFilterDropdown } from "./_components/InactiveBaseTelegramFilterDropdown";
import type {
  InstInstagramCounts,
  InstInstagramFilterValue,
} from "@/lib/inactive-base/instagram-presence-filter";
import type {
  TelegramCanSendCounts,
  TelegramCanSendFilterValue,
} from "@/lib/inactive-base/telegram-can-send-filter";

export type InactiveBaseSortField =
  | "name"
  | "instagramUsername"
  | "messagesTotal"
  | "telegramMessagesTotal"
  | "phone"
  | "daysSinceLastVisit";

type InactiveBaseCounts = {
  inactive: number;
  consultationAttended: number;
  consultationNotAttended: number;
};

const BASE_VIEW_LABELS: Record<InactiveBaseView, string> = {
  inactive: "Неактивна база",
  consultation_attended: "Консультація відбулись",
  consultation_not_attended: "Консультація не відбулась",
};

const BASE_VIEW_SHORT_LABELS: Record<InactiveBaseView, string> = {
  inactive: "Неактивна",
  consultation_attended: "Відбулись",
  consultation_not_attended: "Не відбулись",
};

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
  const router = useRouter();
  const campaignIdFromUrl = searchParams.get("campaignId")?.trim() || "";
  const baseView = parseInactiveBaseView(searchParams.get("base"));
  const isInactiveBaseView = baseView === "inactive";

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
  const [baseCounts, setBaseCounts] = useState<InactiveBaseCounts | null>(null);
  const [showCampaignColumn, setShowCampaignColumn] = useState(false);
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilterMeta>(null);
  const [expandedCampaignIds, setExpandedCampaignIds] = useState<Set<string>>(new Set());
  const [selectedCampaignGroupId, setSelectedCampaignGroupId] = useState<string | null>(null);
  /** Галочка лідера згорнутої групи = усі клієнти кампанії */
  const [selectedCollapsedGroupIds, setSelectedCollapsedGroupIds] = useState<Set<string>>(new Set());
  const [transferTargetCampaignId, setTransferTargetCampaignId] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [ensureName, setEnsureName] = useState("");
  const [ensuring, setEnsuring] = useState(false);
  const [showEnsureClientModal, setShowEnsureClientModal] = useState(false);
  const [ensureModalMounted, setEnsureModalMounted] = useState(false);
  const [instInstagramFilter, setInstInstagramFilter] = useState<InstInstagramFilterValue[]>([]);
  const [instInstagramCounts, setInstInstagramCounts] = useState<InstInstagramCounts | null>(null);
  const [telegramCanSendFilter, setTelegramCanSendFilter] = useState<TelegramCanSendFilterValue[]>(
    []
  );
  const [telegramCanSendCounts, setTelegramCanSendCounts] = useState<TelegramCanSendCounts | null>(
    null
  );
  const [permissions, setPermissions] = useState<Record<string, string> | null>(null);
  const [binotelHistoryClient, setBinotelHistoryClient] = useState<DirectClient | null>(null);
  const [linkHistoryClient, setLinkHistoryClient] = useState<InactiveBaseClientRow | null>(null);
  const [inlineRecordingUrl, setInlineRecordingUrl] = useState<string | null>(null);
  /** Індекс останнього кліку по чекбоксу — для виділення діапазону з Shift */
  const lastCheckboxIndexRef = useRef<number | null>(null);
  /** Захист від гонки запитів — інкремент лише на старті loadClients */
  const loadRequestIdRef = useRef(0);
  const isFirstBaseViewEffect = useRef(true);

  const canListenCalls = permissions == null || permissions.callsListen !== "none";

  const enableCampaignGrouping = !campaignFilter;
  const displayRows = useMemo(
    () => buildDisplayRows(clients, expandedCampaignIds, enableCampaignGrouping),
    [clients, expandedCampaignIds, enableCampaignGrouping]
  );
  const numberedDisplayRows = useMemo(
    () => assignDisplayRowNumbers(displayRows),
    [displayRows]
  );
  const campaignTelegramActiveClients = useMemo(
    () => computeCampaignTelegramActiveClientCounts(clients),
    [clients]
  );
  const campaignInstagramActiveClients = useMemo(
    () => computeCampaignInstagramActiveClientCounts(clients),
    [clients]
  );
  const campaignBinotelTotalCalls = useMemo(
    () => computeCampaignBinotelTotalCallCounts(clients),
    [clients]
  );
  const campaignLinkClickedClients = useMemo(
    () => computeCampaignLinkClickedClientCounts(clients),
    [clients]
  );
  const campaignAudienceCounts = useMemo(
    () => computeCampaignAudienceCountsByCampaignId(clients),
    [clients]
  );

  const tableColSpan = 13;

  const openBinotelHistory = useCallback((client: InactiveBaseClientRow) => {
    setBinotelHistoryClient(inactiveBaseRowToDirectClient(client));
  }, []);

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
    const requestId = ++loadRequestIdRef.current;
    const requestedBase = baseView;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: "500",
        sortBy,
        sortOrder,
        base: requestedBase,
      });
      if (search.trim()) params.set("search", search.trim());
      if (campaignIdFromUrl) params.set("campaignId", campaignIdFromUrl);
      if (instInstagramFilter.length) params.set("instInstagram", instInstagramFilter.join(","));
      if (telegramCanSendFilter.length) params.set("telegramCanSend", telegramCanSendFilter.join(","));
      const res = await fetch(`/api/admin/direct/inactive-base/clients?${params}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();
      if (requestId !== loadRequestIdRef.current) return;
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setClients(Array.isArray(data.clients) ? data.clients : []);
      setTotalCount(Number(data.totalCount ?? 0));
      setShowCampaignColumn(Boolean(data.showCampaignColumn));
      setCampaignFilter(
        data.campaignFilter && typeof data.campaignFilter === "object"
          ? { id: String(data.campaignFilter.id), name: String(data.campaignFilter.name) }
          : null
      );
      if (data.instInstagramCounts && typeof data.instInstagramCounts === "object") {
        setInstInstagramCounts({
          has: Number(data.instInstagramCounts.has ?? 0),
          missing: Number(data.instInstagramCounts.missing ?? 0),
        });
      }
      if (data.telegramCanSendCounts && typeof data.telegramCanSendCounts === "object") {
        setTelegramCanSendCounts({
          can: Number(data.telegramCanSendCounts.can ?? 0),
          cannot: Number(data.telegramCanSendCounts.cannot ?? 0),
        });
      }
      if (data.baseCounts && typeof data.baseCounts === "object") {
        setBaseCounts({
          inactive: Number(data.baseCounts.inactive ?? 0),
          consultationAttended: Number(data.baseCounts.consultationAttended ?? 0),
          consultationNotAttended: Number(data.baseCounts.consultationNotAttended ?? 0),
        });
      }
    } catch (e) {
      if (requestId !== loadRequestIdRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }, [search, sortBy, sortOrder, campaignIdFromUrl, instInstagramFilter, telegramCanSendFilter, baseView]);

  const switchBaseView = useCallback(
    (next: InactiveBaseView) => {
      if (next === baseView) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === "inactive") params.delete("base");
      else params.set("base", next);
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "/admin/direct/inactive-base");
    },
    [baseView, router, searchParams]
  );

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
    setEnsureModalMounted(true);
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    if (isFirstBaseViewEffect.current) {
      isFirstBaseViewEffect.current = false;
      setSortBy("daysSinceLastVisit");
      setSortOrder("desc");
      return;
    }
    setClients([]);
    setTotalCount(0);
    setSelectedIds(new Set());
    setSelectedCollapsedGroupIds(new Set());
    setSelectedCampaignGroupId(null);
    setExpandedCampaignIds(new Set());
    setSortBy("daysSinceLastVisit");
    setSortOrder("desc");
  }, [baseView]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.ok && data.permissions) {
          setPermissions(data.permissions);
        } else if (!cancelled) {
          setPermissions({});
        }
      })
      .catch(() => {
        if (!cancelled) setPermissions({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setShowEnsureClientModal(false);
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
      const linkText = (campaign.linkLabel || "").trim();
      const body = campaign.bodyTemplate
        .replace(/\{\{\s*ПІБ\s*\}\}/gi, name)
        .replace(/\{\{\s*імя\s*\}\}/gi, c.firstName || name)
        .replace(/\{\{\s*прізвище\s*\}\}/gi, c.lastName || "")
        .replace(/\{\{\s*посилання\s*\}\}/gi, linkText);
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
        <div className="bg-base-100 rounded-lg border border-base-300 px-2 py-1.5 mb-2">
        <div className="flex flex-wrap gap-1 items-end">
          <Link href="/admin/direct" className="btn btn-xs btn-ghost shrink-0 mb-0 min-h-6 h-6 px-1.5 text-[10px]">
            ← Direct
          </Link>
          <div className="inline-flex flex-wrap gap-px rounded border border-base-300 p-px shrink-0">
            {(
              [
                ["inactive", baseCounts?.inactive],
                ["consultation_attended", baseCounts?.consultationAttended],
                ["consultation_not_attended", baseCounts?.consultationNotAttended],
              ] as const
            ).map(([view, count]) => (
              <button
                key={view}
                type="button"
                className={`btn btn-xs min-h-6 h-6 px-1.5 text-[10px] font-normal ${
                  baseView === view ? "btn-primary" : "btn-ghost"
                }`}
                title={BASE_VIEW_LABELS[view]}
                onClick={() => switchBaseView(view)}
              >
                {BASE_VIEW_SHORT_LABELS[view]}
                {typeof count === "number" ? ` ${count}` : ""}
              </button>
            ))}
          </div>
          <div>
            <label className="text-[10px] block mb-0.5 leading-none">Пошук</label>
            <div className="relative w-40">
              <input
                className="input input-bordered input-xs w-full h-6 min-h-6 text-[10px] pr-6"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ПІБ, Instagram, телефон"
              />
              {search.trim() ? (
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-red-500 hover:text-red-700 text-sm leading-none px-0.5"
                  title="Очистити пошук"
                  aria-label="Очистити пошук"
                  onClick={() => setSearch("")}
                >
                  ✕
                </button>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-xs min-h-6 h-6 text-[10px]"
            disabled={loading}
            onClick={() => void loadClients()}
          >
            {loading ? "…" : "Оновити"}
          </button>
          {showCampaignColumn ? (
            <div className="flex flex-wrap items-end gap-1 relative z-10">
              <div>
                <label className="text-[10px] block mb-0.5 leading-none">Кампанія (група)</label>
                <select
                  className="block min-w-[220px] w-56 h-7 max-h-7 rounded-lg border border-gray-300 bg-white px-2 pr-7 text-[11px] leading-7 text-slate-900 appearance-auto cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={transferTargetCampaignId}
                  title={
                    someSelected
                      ? "Оберіть групу для перенесення або «Немає групи» для вилучення"
                      : "Перелік груп; для перенесення спочатку виділіть клієнтів чекбоксами"
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
                className={`btn btn-xs btn-outline min-h-6 h-6 text-[10px] ${canTransferToCampaign ? "" : "btn-disabled opacity-40"}`}
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
            className={`btn btn-xs btn-primary min-h-6 h-6 text-[10px] ${canCreateCampaign ? "" : "btn-disabled opacity-40"}`}
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
          <div className="flex flex-wrap items-end gap-1 ml-auto shrink-0">
            {enableCampaignGrouping ? (
              canOpenInDirect ? (
                <button
                  type="button"
                  className="btn btn-xs btn-outline min-h-6 h-6 text-[10px]"
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
                  className="btn btn-xs btn-outline btn-disabled opacity-40 min-h-6 h-6 text-[10px]"
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
              className="btn btn-xs btn-outline min-h-6 h-6 text-[10px]"
            >
              Кампанії
            </Link>
            {isInactiveBaseView ? (
              <button
                type="button"
                className="btn btn-xs btn-outline min-h-6 h-6 w-6 px-0 text-sm leading-none"
                title="Додати в базу (ПІБ) — клієнт має бути в Direct"
                aria-label="Додати в базу"
                onClick={() => setShowEnsureClientModal(true)}
              >
                +
              </button>
            ) : null}
          </div>
          {someSelected && selectedCampaignId ? (
            <button
              type="button"
              className="btn btn-xs btn-ghost min-h-6 h-6 text-[10px]"
              onClick={() => void copyCampaignTexts()}
            >
              Скопіювати тексти кампанії ({effectiveActionClientIds.length})
            </button>
          ) : null}
        </div>
        </div>

        {campaignFilter ? (
          <div className="alert alert-info text-sm mb-3 py-2 flex flex-wrap items-center gap-2">
            <span>
              Кампанія «{campaignFilter.name}» — {totalCount} клієнтів
            </span>
            <Link
              href={
                baseView === "inactive"
                  ? "/admin/direct/inactive-base"
                  : `/admin/direct/inactive-base?base=${baseView}`
              }
              className="btn btn-xs btn-ghost"
            >
              Уся база
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
                <th className="text-[10px] whitespace-nowrap">Статус повідомлень</th>
                <th className="text-[10px] whitespace-nowrap" title="Клік по посиланню кампанії">
                  Посилання
                </th>
                <SortableTh
                  label="Instagram"
                  field="instagramUsername"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <th>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className={`hover:underline cursor-pointer text-left font-semibold text-[10px] ${
                        sortBy === "messagesTotal" ? "text-primary" : "text-inherit"
                      }`}
                      onClick={() => handleSort("messagesTotal")}
                    >
                      Inst
                      {sortBy === "messagesTotal" ? (sortOrder === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                    <InactiveBaseInstagramFilterDropdown
                      value={instInstagramFilter}
                      onChange={setInstInstagramFilter}
                      counts={instInstagramCounts}
                    />
                  </div>
                </th>
                <th className="text-[10px] whitespace-nowrap">Статус повідомлень</th>
                <SortableTh label="Телефон" field="phone" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <th className="text-[10px] whitespace-nowrap">Дзвінки</th>
                <th className="text-[10px] whitespace-nowrap">Статус дзвінків</th>
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
                    {baseView === "inactive"
                      ? "Немає клієнтів у неактивній базі"
                      : baseView === "consultation_attended"
                        ? "Немає клієнтів із відбулоюся консультацією"
                        : "Немає клієнтів із невідбулоюся консультацією"}
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
                  const isCollapsedGroupLeader =
                    isLeader && !expanded && row.kind === "campaignLeader";
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
                      : isCollapsedGroupLeader
                        ? "!bg-sky-100"
                        : inCampaignGroup
                          ? "!bg-sky-50"
                          : "";

                  const rowBorder = [
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
                      <td className="tabular-nums text-xs align-middle min-w-0 max-w-[280px] overflow-visible">
                        {isLeader && row.kind === "campaignLeader" ? (
                          <div className="flex items-center gap-1 min-w-0 whitespace-nowrap overflow-visible">
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
                            {isCollapsedGroupLeader &&
                            (row.client.lastCampaign?.channels ?? ["instagram", "telegram"]).includes(
                              "telegram"
                            ) ? (
                              <button
                                type="button"
                                className="shrink-0 overflow-visible"
                                onClick={() => selectCampaignGroup(row.campaignId)}
                              >
                                <InactiveBaseCampaignAudienceBadges
                                  tooltipScope="групі"
                                  counts={
                                    campaignAudienceCounts.get(row.campaignId) ?? {
                                      total: row.memberCount,
                                      activated: 0,
                                      nonActivated: row.memberCount,
                                    }
                                  }
                                />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="text-[11px] text-primary font-medium tabular-nums shrink-0 hover:underline"
                                title={`Обрати групу (${row.memberCount} клієнтів)`}
                                onClick={() => selectCampaignGroup(row.campaignId)}
                              >
                                {row.memberCount} клієнтів
                              </button>
                            )}
                          </div>
                        ) : isMember ? (
                          <span className="pl-5 inline-block tabular-nums">{row.clientNumberInGroup}</span>
                        ) : (
                          <span className="tabular-nums">{row.soloNumber}</span>
                        )}
                      </td>
                      <td
                        className={`text-xs whitespace-nowrap max-w-[200px] truncate ${isMember || (isLeader && expanded) ? "pl-4" : ""}`}
                        title={isCollapsedGroupLeader ? row.campaignName : fullName}
                      >
                        {isCollapsedGroupLeader ? (
                          <div className="flex flex-col min-w-0 gap-0.5">
                            <Link
                              href={buildInactiveBaseCampaignsUrl(row.campaignId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="link link-primary font-bold truncate"
                              title={`Кампанія «${row.campaignName}»`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {row.campaignName}
                            </Link>
                            {client.lastCampaign?.createdAt ? (
                              <span
                                className="text-[10px] text-base-content/50 tabular-nums leading-none"
                                title={`Створено: ${formatDateDDMMYY(client.lastCampaign.createdAt)}`}
                              >
                                {formatDateDDMMYY(client.lastCampaign.createdAt)}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <Link
                            href={buildDirectClientsUrl([client.id], fullName)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link link-hover"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {fullName}
                          </Link>
                        )}
                      </td>
                      <td className="text-xs overflow-visible">
                        <InactiveBaseChatCell
                          client={client}
                          channel="telegram"
                          key={`${client.id}-tg`}
                          groupTelegramStats={
                            isCollapsedGroupLeader
                              ? campaignTelegramActiveClients.get(row.campaignId) ?? {
                                  outgoingManualCount: 0,
                                  outgoingSystemCount: 0,
                                  incomingCount: 0,
                                }
                              : null
                          }
                        />
                      </td>
                      <td className="text-xs align-top">
                        <InactiveBaseMessageStatusCell
                          client={client}
                          channel="telegram"
                          hidden={isCollapsedGroupLeader}
                        />
                      </td>
                      <td className="text-xs align-top overflow-visible">
                        <InactiveBaseLinkClickCell
                          hasTrackableLink={Boolean(client.campaignHasTrackableLink)}
                          clicked={Boolean(client.campaignLinkClicked)}
                          clickedInCurrentCampaign={Boolean(
                            client.campaignLinkClickedInCurrentCampaign
                          )}
                          clickedAt={client.campaignLinkClickedAt ?? null}
                          clickCount={client.campaignLinkClickCount ?? 0}
                          groupLinkClickedCount={
                            isCollapsedGroupLeader
                              ? campaignLinkClickedClients.get(row.campaignId) ?? 0
                              : null
                          }
                          onOpenHistory={
                            !isCollapsedGroupLeader && client.campaignLinkClicked
                              ? () => setLinkHistoryClient(client)
                              : undefined
                          }
                        />
                      </td>
                      <td className={`text-xs ${isMember ? "pl-4" : ""}`}>
                        {isCollapsedGroupLeader ? (
                          <span className="text-base-content/40">—</span>
                        ) : (
                          <InactiveBaseInstagramUsernameCell
                            clientId={client.id}
                            instagramUsername={client.instagramUsername}
                          />
                        )}
                      </td>
                      <td className="text-xs overflow-visible">
                        <InactiveBaseChatCell
                          client={client}
                          channel="instagram"
                          key={`${client.id}-ig`}
                          groupInstagramStats={
                            isCollapsedGroupLeader
                              ? campaignInstagramActiveClients.get(row.campaignId) ?? {
                                  incomingCount: 0,
                                  outgoingCount: 0,
                                }
                              : null
                          }
                        />
                      </td>
                      <td className="text-xs align-top">
                        <InactiveBaseMessageStatusCell
                          client={client}
                          channel="instagram"
                          hidden={isCollapsedGroupLeader}
                        />
                      </td>
                      <td className={`text-xs whitespace-nowrap ${isMember ? "pl-4" : ""}`}>
                        {isCollapsedGroupLeader ? (
                          <span className="text-base-content/40">—</span>
                        ) : (
                          <div className="flex items-center gap-1 min-w-0">
                            {client.phone ? (
                              <button
                                type="button"
                                className="link link-hover font-mono truncate max-w-[120px] text-left"
                                title={`${client.phone} — історія дзвінків`}
                                onClick={() => openBinotelHistory(client)}
                              >
                                {client.phone}
                              </button>
                            ) : (
                              <span className="text-base-content/40">—</span>
                            )}
                            {client.phone ? (
                              <button
                                type="button"
                                className="inline-flex h-6 shrink-0 items-center justify-center rounded-md px-0.5 text-base hover:bg-black/5"
                                title="Надіслати телефон клієнта в Telegram адміністратора"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void sendPhoneToTelegram(client.id);
                                }}
                              >
                                📞
                              </button>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="text-xs align-top">
                        <InactiveBaseCallsCell
                          client={client}
                          groupCallsTotal={
                            isCollapsedGroupLeader
                              ? campaignBinotelTotalCalls.get(row.campaignId) ?? 0
                              : null
                          }
                          canListenCalls={canListenCalls}
                          onOpenHistory={(dc) => setBinotelHistoryClient(dc)}
                          onPlayRequest={(url) => setInlineRecordingUrl(url)}
                        />
                      </td>
                      <td className="text-xs align-top">
                        <InactiveBaseCallStatusCell client={client} hidden={isCollapsedGroupLeader} />
                      </td>
                      <td className="text-xs text-right tabular-nums">
                        {isCollapsedGroupLeader ? (
                          <span className="text-base-content/40">—</span>
                        ) : typeof client.daysSinceLastVisit === "number" ? (
                          client.daysSinceLastVisit
                        ) : (
                          "—"
                        )}
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
          Виділення: Shift+клік між чекбоксами. Inst, Telegram і дзвінки — як у Direct. Клік по телефону — історія дзвінків. Клік по галочці в «Посилання» — історія переходів.
          Автоматична розсилка вимкнена.
        </p>
      </div>

      {ensureModalMounted && showEnsureClientModal
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center p-4"
              style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
              onClick={() => setShowEnsureClientModal(false)}
              role="presentation"
            >
              <div
                className="bg-white rounded-lg shadow-xl w-full max-w-sm border border-gray-200 p-4"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-labelledby="ensure-client-title"
              >
                <h3 id="ensure-client-title" className="font-semibold text-sm text-slate-900 mb-1">
                  Додати в базу
                </h3>
                <p className="text-[10px] text-gray-500 mb-2">
                  Клієнт має бути в Direct; дата візиту зсувається на 110+ днів назад.
                </p>
                <input
                  className="input input-bordered input-sm w-full text-xs mb-2"
                  value={ensureName}
                  onChange={(e) => setEnsureName(e.target.value)}
                  placeholder="Прізвище Імʼя"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void ensureClientInInactiveBase();
                  }}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    onClick={() => setShowEnsureClientModal(false)}
                  >
                    Скасувати
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-primary"
                    disabled={ensuring || loading}
                    onClick={() => void ensureClientInInactiveBase()}
                  >
                    {ensuring ? "…" : "Додати"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      <InactiveBaseLinkClickHistoryModal
        client={linkHistoryClient}
        isOpen={!!linkHistoryClient}
        onClose={() => setLinkHistoryClient(null)}
      />
      <BinotelCallHistoryModal
        client={binotelHistoryClient}
        isOpen={!!binotelHistoryClient}
        onClose={() => setBinotelHistoryClient(null)}
        onPlayRequest={(url) => setInlineRecordingUrl(url)}
        canListenCalls={canListenCalls}
        showCallStatusPanel
        onCallStatusUpdated={() => {
          window.dispatchEvent(new CustomEvent("inactive-base:reload-clients"));
        }}
      />
      {inlineRecordingUrl ? (
        <InlineCallRecordingPlayer url={inlineRecordingUrl} onClose={() => setInlineRecordingUrl(null)} />
      ) : null}
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
