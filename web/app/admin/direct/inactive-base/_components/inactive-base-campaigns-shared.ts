// Спільні типи та константи для кампаній неактивної бази

export type InactiveBaseCampaign = {
  id: string;
  name: string;
  bodyTemplate: string;
  channels: string[] | unknown;
  createdAt: string;
  updatedAt: string;
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
