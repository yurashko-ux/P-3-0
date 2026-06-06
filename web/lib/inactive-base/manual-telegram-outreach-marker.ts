// Маркер ідентифікації для ручної TG-розсилки (коли в шаблоні немає {{ПІБ}}).

import {
  getClientFullName,
  type CampaignNameFields,
} from '@/lib/inactive-base/campaign-template';

/** Нульова ширина + тонкий пробіл перед маркером — ледь помітно навіть без spoiler. */
const ZW = '\u200b';
const HAIR = '\u200a';

const TRACKING_RE = /[\u200b\u200a\u2009]*·\s*dc:([a-z0-9_]{10,48})/i;

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

/** Текст маркера (plain) для matching. */
export function buildOutreachTrackingCodePlain(clientId: string): string {
  return `${ZW}${HAIR}·dc:${clientId}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** HTML: spoiler + курсив — майже непомітно для клієнта, текст зберігається при копіюванні. */
export function buildOutreachTrackingCodeHtml(clientId: string): string {
  const plain = buildOutreachTrackingCodePlain(clientId);
  return `<tg-spoiler><i>${escapeHtml(plain)}</i></tg-spoiler>`;
}

/** Очікуваний текст шаблону для matching (без телефону та ПІБ зверху). */
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

/**
 * Одне повідомлення для копіювання: телефон → ПІБ → текст шаблону → маркер (якщо потрібен).
 */
export function buildAdminCopyableMessageHtml(
  phoneDisplay: string,
  personalizedBody: string,
  bodyTemplate: string,
  clientId: string,
  fields: CampaignNameFields
): string {
  const pib = getClientFullName(fields);
  const parts = [
    escapeHtml(phoneDisplay),
    escapeHtml(pib),
    escapeHtml(personalizedBody.trim()),
  ];
  let html = parts.join('\n\n');
  if (needsOutreachTrackingCode(bodyTemplate, personalizedBody, fields)) {
    html += `\n${buildOutreachTrackingCodeHtml(clientId)}`;
  }
  return html;
}

/** Витягнути clientId з маркера у вихідному повідомленні. */
export function parseOutreachTrackingClientId(text: string): string | null {
  const m = text.match(TRACKING_RE);
  return m?.[1] ?? null;
}

/** Прибрати маркер перед порівнянням з personalizedBody. */
export function stripOutreachTrackingCode(text: string): string {
  return text.replace(/[\n\s]*[\u200b\u200a\u2009]*·\s*dc:[a-z0-9_]+\s*$/i, '').trim();
}

/** Прибрати телефон і ПІБ з початку (якщо адмін скопіював усе повідомлення). */
export function stripAdminPackHeader(text: string, pib?: string | null): string {
  let t = stripOutreachTrackingCode(text);
  t = t.replace(/^\+?380\d{9}\s*\n+/m, '').trim();
  if (pib && pib.length >= 4 && pib !== 'клієнте') {
    const escaped = pib.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`^${escaped}\\s*\\n+`, 'm'), '').trim();
  }
  return t;
}
