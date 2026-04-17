// web/lib/altegio/client-utils.ts
// Спільні утиліти для роботи з даними клієнта Altegio (API та webhook)

import { normalizeInstagram } from '@/lib/normalize';

/** Значення, що означають відсутність Instagram. */
const INVALID_INSTAGRAM_VALUES = ['no', 'ні', 'none', 'null', 'undefined', '', 'n/a', 'немає', 'нема'];

/**
 * Витягує сире значення Instagram (без фільтрації) для визначення isExplicitNoInstagram.
 * Використовується коли потрібно відрізнити "no"/"ні" від відсутності поля.
 */
export function extractInstagramRaw(client: any): string | null {
  if (!client || typeof client !== 'object') return null;
  const addFromCustomFields = (cf: any) => {
    const out: string[] = [];
    if (Array.isArray(cf)) {
      for (const f of cf) {
        if (f?.value && typeof f.value === 'string') out.push(f.value.trim());
        const title = (f?.title || f?.name || '').toString();
        const val = f?.value || f?.data || f?.content || f?.text;
        if (val && typeof val === 'string' && /instagram/i.test(title)) out.push(val.trim());
      }
    } else if (cf && typeof cf === 'object') {
      for (const k of Object.keys(cf)) {
        if (!/instagram/i.test(k)) continue;
        const v = cf[k];
        if (v && typeof v === 'string') out.push(v.trim());
        else if (v && typeof v === 'object') {
          const n = v.value ?? v.data ?? v.content ?? v.text;
          if (n && typeof n === 'string') out.push(n.trim());
        }
      }
    }
    return out;
  };
  const candidates = [
    client['instagram-user-name'],
    client.instagram_user_name,
    client.instagramUsername,
    client?.custom_fields ? addFromCustomFields(client.custom_fields) : [],
  ].flat();
  const str = candidates.find((s) => s && typeof s === 'string');
  return str ? String(str).trim() : null;
}

/**
 * Витягує Instagram username з об'єкта клієнта Altegio (API або webhook).
 * Підтримує custom_fields у вигляді масиву та об'єкта.
 * Повертає null, якщо значення порожнє або в списку невалідних.
 */
export function extractInstagramFromAltegioClient(client: any): string | null {
  if (!client || typeof client !== 'object') return null;

  const instagramFields: (string | null | undefined)[] = [
    client['instagram-user-name'],
    client.instagram_user_name,
    client.instagramUsername,
    client.instagram_username,
    client.instagram,
  ];

  if (Array.isArray(client.custom_fields)) {
    for (const field of client.custom_fields) {
      if (field && typeof field === 'object') {
        const title = (field.title || field.name || field.label || '').toString();
        const value = field.value || field.data || field.content || field.text || '';
        if (value && typeof value === 'string' && /instagram/i.test(title)) {
          instagramFields.push(value.trim());
        }
      }
    }
  } else if (client.custom_fields && typeof client.custom_fields === 'object' && !Array.isArray(client.custom_fields)) {
    const cf = client.custom_fields;
    instagramFields.push(
      cf['instagram-user-name'],
      cf['Instagram user name'],
      cf['Instagram username'],
      cf.instagram_user_name,
      cf.instagramUsername,
      cf.instagram,
      cf['instagram'],
    );
    for (const key of Object.keys(cf)) {
      if (/instagram/i.test(key)) {
        const v = cf[key];
        if (v && typeof v === 'string') instagramFields.push(v.trim());
        else if (v && typeof v === 'object') {
          const nested = v.value ?? v.data ?? v.content ?? v.text;
          if (nested && typeof nested === 'string') instagramFields.push(nested.trim());
        }
      }
    }
  }

  for (const field of instagramFields) {
    if (field && typeof field === 'string') {
      const trimmed = field.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (INVALID_INSTAGRAM_VALUES.includes(lower)) return null;
      const normalized = normalizeInstagram(trimmed);
      if (normalized) return normalized;
    }
  }
  return null;
}

/**
 * Витягує ім'я та прізвище з об'єкта клієнта Altegio.
 */
export function extractNameFromAltegioClient(client: any): { firstName?: string; lastName?: string } {
  const nameStr = (client?.name || client?.display_name || '').toString().trim();
  if (!nameStr) return {};
  const nameParts = nameStr.split(/\s+/);
  if (nameParts.length === 0) return {};
  if (nameParts.length === 1) return { firstName: nameParts[0] };
  return {
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(' '),
  };
}

/**
 * Унікальний технічний instagramUsername у Direct, коли в Altegio немає реального Instagram.
 * Якщо з імені не виходить латинський slug (лише кирилиця → порожній рядок після фільтра),
 * підставляємо `client`, щоб не було `altegio__123` (подвійне підкреслення).
 */
export function buildAltegioFallbackInstagramUsername(
  altegioId: number,
  firstName?: string | null,
  lastName?: string | null
): string {
  const raw = (firstName || lastName || 'client')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 10);
  const nameSlug = raw || 'client';
  return `altegio_${nameSlug}_${altegioId}`;
}
