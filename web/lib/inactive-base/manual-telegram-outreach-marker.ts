// Маркер ідентифікації для ручної TG-розсилки (коли в шаблоні немає {{ПІБ}}).

import {
  getClientFullName,
  type CampaignNameFields,
} from '@/lib/inactive-base/campaign-template';

const TRACKING_RE = /·\s*dc:([a-z0-9]{10,32})/i;

/** Чи є в шаблоні плейсхолдер повного імені. */
export function campaignTemplateIncludesPib(template: string): boolean {
  return (
    /\{\{\s*ПІБ\s*\}\}/i.test(template) ||
    /\{\{\s*name\s*\}\}/i.test(template) ||
    (/\{\{\s*імя\s*\}\}/i.test(template) && /\{\{\s*прізвище\s*\}\}/i.test(template)) ||
    (/\{\{\s*firstName\s*\}\}/i.test(template) && /\{\{\s*lastName\s*\}\}/i.test(template))
  );
}

/** Чи містить згенерований текст повне ПІБ клієнта. */
export function renderedBodyIncludesFullName(
  body: string,
  fields: CampaignNameFields
): boolean {
  const name = getClientFullName(fields);
  if (name.length < 4 || name === 'клієнте') return false;
  return body.includes(name);
}

/** Чи потрібен прихований код ідентифікації в кінці повідомлення. */
export function needsOutreachTrackingCode(
  bodyTemplate: string,
  personalizedBody: string,
  fields: CampaignNameFields
): boolean {
  if (campaignTemplateIncludesPib(bodyTemplate)) return false;
  if (renderedBodyIncludesFullName(personalizedBody, fields)) return false;
  return true;
}

/** Текст маркера (plain) для збереження та matching. */
export function buildOutreachTrackingCodePlain(clientId: string): string {
  return `· dc:${clientId}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** HTML: курсив, ледь помітний маркер в кінці. */
export function buildOutreachTrackingCodeHtml(clientId: string): string {
  return `<i>${escapeHtml(buildOutreachTrackingCodePlain(clientId))}</i>`;
}

/** Очікуваний текст для matching (те, що адмін копіює клієнту). */
export function buildExpectedMatchBody(
  personalizedBody: string,
  bodyTemplate: string,
  clientId: string,
  fields: CampaignNameFields
): string {
  const base = personalizedBody.trim();
  if (!needsOutreachTrackingCode(bodyTemplate, base, fields)) return base;
  return `${base}\n${buildOutreachTrackingCodePlain(clientId)}`;
}

/** HTML-повідомлення для адміна: лише шаблон + опційний маркер. */
export function buildAdminTemplateMessageHtml(
  personalizedBody: string,
  bodyTemplate: string,
  clientId: string,
  fields: CampaignNameFields
): string {
  const escaped = escapeHtml(personalizedBody.trim());
  if (!needsOutreachTrackingCode(bodyTemplate, personalizedBody, fields)) {
    return escaped;
  }
  return `${escaped}\n${buildOutreachTrackingCodeHtml(clientId)}`;
}

/** Витягнути clientId з маркера у вихідному повідомленні. */
export function parseOutreachTrackingClientId(text: string): string | null {
  const m = text.match(TRACKING_RE);
  return m?.[1] ?? null;
}

/** Прибрати маркер перед порівнянням з personalizedBody. */
export function stripOutreachTrackingCode(text: string): string {
  return text.replace(/\n?·\s*dc:[a-z0-9]+\s*$/i, '').trim();
}
