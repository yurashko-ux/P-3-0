// Спільні типи та константи для кампаній неактивної бази

export type InactiveBaseCampaign = {
  id: string;
  name: string;
  bodyTemplate: string;
  channels: string[] | unknown;
  createdAt: string;
  updatedAt: string;
  clientCount?: number;
  respondedCount?: number;
  runs?: Array<{
    id: string;
    channel: string;
    startedAt: string;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
    selectedCount: number;
  }>;
};

export const INACTIVE_BASE_SELECTED_CAMPAIGN_KEY = "inactive-base:selected-campaign-id";
/** Значення select «Перенести» — зняти клієнтів з групи. */
export const INACTIVE_BASE_TRANSFER_NO_GROUP = "__none__";
export const INACTIVE_BASE_PENDING_CAMPAIGN_CLIENTS_KEY = "inactive-base:pending-campaign-client-ids";
export const INACTIVE_BASE_CAMPAIGNS_CHANGED_EVENT = "inactive-base:campaigns-changed";

export const DEFAULT_CAMPAIGN_BODY = "Привіт, {{ПІБ}}! Давно не бачились у салоні…";

export function parseCampaignChannels(ch: unknown): string[] {
  if (!Array.isArray(ch)) return ["instagram", "telegram"];
  return ch.filter((x) => x === "instagram" || x === "telegram") as string[];
}

export function readSelectedCampaignId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(INACTIVE_BASE_SELECTED_CAMPAIGN_KEY);
}

export function writeSelectedCampaignId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) {
    localStorage.setItem(INACTIVE_BASE_SELECTED_CAMPAIGN_KEY, id);
  } else {
    localStorage.removeItem(INACTIVE_BASE_SELECTED_CAMPAIGN_KEY);
  }
  window.dispatchEvent(new CustomEvent("inactive-base:campaign-selected"));
}

function parsePendingClientIdsJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return [];
  }
}

/** localStorage — спільний між вкладками (sessionStorage у новій вкладці порожній). */
export function readPendingCampaignClientIds(): string[] {
  if (typeof window === "undefined") return [];
  let raw = localStorage.getItem(INACTIVE_BASE_PENDING_CAMPAIGN_CLIENTS_KEY);
  if (!raw) {
    raw = sessionStorage.getItem(INACTIVE_BASE_PENDING_CAMPAIGN_CLIENTS_KEY);
    if (raw) {
      localStorage.setItem(INACTIVE_BASE_PENDING_CAMPAIGN_CLIENTS_KEY, raw);
      sessionStorage.removeItem(INACTIVE_BASE_PENDING_CAMPAIGN_CLIENTS_KEY);
    }
  }
  return parsePendingClientIdsJson(raw);
}

export function writePendingCampaignClientIds(ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(INACTIVE_BASE_PENDING_CAMPAIGN_CLIENTS_KEY, JSON.stringify(ids));
}

export function clearPendingCampaignClientIds() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(INACTIVE_BASE_PENDING_CAMPAIGN_CLIENTS_KEY);
  sessionStorage.removeItem(INACTIVE_BASE_PENDING_CAMPAIGN_CLIENTS_KEY);
}

export function notifyCampaignsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(INACTIVE_BASE_CAMPAIGNS_CHANGED_EVENT));
}

/** Розділ кампаній неактивної бази (опційно з виділенням кампанії). */
export function buildInactiveBaseCampaignsUrl(campaignId?: string): string {
  const base = "/admin/direct/inactive-base/campaigns";
  if (!campaignId?.trim()) return base;
  return `${base}?campaignId=${encodeURIComponent(campaignId.trim())}`;
}

/** Перехід у Direct з фільтром по id клієнтів (неактивна база / кампанія). */
export function buildDirectClientsUrl(clientIds: string[], label?: string): string {
  const ids = clientIds.filter((id) => typeof id === "string" && id.trim().length > 0);
  if (ids.length === 0) return "/admin/direct";
  const params = new URLSearchParams();
  params.set("clientIds", ids.join(","));
  params.set("source", "inactiveBase");
  if (label?.trim()) params.set("label", label.trim());
  return `/admin/direct?${params.toString()}`;
}
