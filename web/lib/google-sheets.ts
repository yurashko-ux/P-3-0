// Запис у Google Sheets через сервісний акаунт.
// Ключ: env GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON (весь JSON одним рядком). У репозиторій не класти.

import { createSign } from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

export type SheetGrid = {
  title: string;
  rows: unknown[][];
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
    };
  } catch (err) {
    console.error('[google-sheets] Не вдалося розібрати GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON:', err);
    return null;
  }
}

export function googleSheetsConfigured(): boolean {
  return loadServiceAccount() != null;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }
  const account = loadServiceAccount();
  if (!account) {
    throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON не задано');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = base64url(signer.sign(account.private_key));
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Google token: ${body.error || res.status}`);
  }
  cachedToken = {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return body.access_token;
}

async function sheetsFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
}

export async function getSheetTitleById(spreadsheetId: string, sheetId: number): Promise<string> {
  const res = await sheetsFetch(
    `${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`,
  );
  const body = (await res.json()) as {
    error?: { message?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };
  if (!res.ok) {
    throw new Error(body.error?.message || `Sheets metadata ${res.status}`);
  }
  const found = body.sheets?.find((s) => s.properties?.sheetId === sheetId);
  const title = found?.properties?.title;
  if (!title) {
    throw new Error(`Аркуш gid=${sheetId} не знайдено`);
  }
  return title;
}

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export async function readSheetGrid(
  spreadsheetId: string,
  title: string,
  a1: string,
): Promise<unknown[][]> {
  const range = encodeURIComponent(`${quoteSheet(title)}!${a1}`);
  const res = await sheetsFetch(
    `${encodeURIComponent(spreadsheetId)}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
  );
  const body = (await res.json()) as { error?: { message?: string }; values?: unknown[][] };
  if (!res.ok) {
    throw new Error(body.error?.message || `Sheets read ${res.status}`);
  }
  return body.values ?? [];
}

export async function writeSheetCells(
  spreadsheetId: string,
  title: string,
  updates: Array<{ a1: string; value: number }>,
): Promise<void> {
  if (updates.length === 0) return;
  const data = updates.map((u) => ({
    range: `${quoteSheet(title)}!${u.a1}`,
    values: [[u.value]],
  }));
  const res = await sheetsFetch(`${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message || `Sheets write ${res.status}`);
  }
}

export function columnIndexToA1(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
