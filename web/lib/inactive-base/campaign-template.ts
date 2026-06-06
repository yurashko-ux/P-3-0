// web/lib/inactive-base/campaign-template.ts
// Персоналізація текстів кампаній для неактивної бази.

export type CampaignNameFields = {
  firstName?: string | null;
  lastName?: string | null;
};

function isBadNamePart(v?: string | null): boolean {
  if (!v) return true;
  const t = v.trim();
  if (!t) return true;
  if (t.includes('{{') || t.includes('}}')) return true;
  if (t.toLowerCase() === 'not found') return true;
  return false;
}

export function getClientFullName(fields: CampaignNameFields): string {
  const parts = [fields.firstName, fields.lastName].filter((p) => !isBadNamePart(p));
  return parts.length ? parts.join(' ').trim() : 'клієнте';
}

export function getClientFirstName(fields: CampaignNameFields): string {
  const first = (fields.firstName || '').trim();
  if (!isBadNamePart(first)) return first;
  const full = getClientFullName(fields);
  if (full === 'клієнте') return full;
  return full.split(/\s+/)[0] || full;
}

export function getClientLastName(fields: CampaignNameFields): string {
  const last = (fields.lastName || '').trim();
  if (!isBadNamePart(last)) return last;
  const full = getClientFullName(fields);
  const parts = full.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

/** Маркер у шаблоні: сюди підставляється активне посилання. */
export const CAMPAIGN_LINK_PLACEHOLDER = '{{посилання}}';

export function campaignTemplateHasLinkPlaceholder(template: string): boolean {
  return /\{\{\s*посилання\s*\}\}/i.test(template);
}

/** Якщо посилання налаштоване, але маркера немає — додаємо в кінець тексту. */
export function ensureLinkPlaceholderInTemplate(
  template: string,
  hasLinkConfig: boolean
): string {
  const trimmed = template.trimEnd();
  if (!hasLinkConfig || campaignTemplateHasLinkPlaceholder(trimmed)) return trimmed;
  return `${trimmed}\n\n${CAMPAIGN_LINK_PLACEHOLDER}`;
}

/** Підстановка {{ПІБ}}, {{імя}}, {{прізвище}} (регістронезалежно для латиниці). */
export function renderCampaignBody(template: string, fields: CampaignNameFields): string {
  const pib = getClientFullName(fields);
  const first = getClientFirstName(fields);
  const last = getClientLastName(fields);
  return template
    .replace(/\{\{\s*ПІБ\s*\}\}/gi, pib)
    .replace(/\{\{\s*імя\s*\}\}/gi, first)
    .replace(/\{\{\s*прізвище\s*\}\}/gi, last)
    .replace(/\{\{\s*name\s*\}\}/gi, pib)
    .replace(/\{\{\s*firstName\s*\}\}/gi, first)
    .replace(/\{\{\s*lastName\s*\}\}/gi, last);
}
