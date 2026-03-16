// web/lib/bank/monobank.ts
// Клієнт Personal API monobank: client-info, statement, webhook

const MONOBANK_API_BASE = "https://api.monobank.ua";

export type MonobankAccount = {
  id: string;
  sendId?: string;
  balance: number;
  creditLimit?: number;
  type?: string;
  currencyCode?: number;
  cashbackType?: string;
  maskedPan?: string[];
  iban?: string;
};

export type MonobankClientInfo = {
  clientId: string;
  name?: string;
  webHookUrl?: string;
  accounts?: MonobankAccount[];
  jars?: unknown[];
};

export type MonobankStatementItem = {
  id: string;
  time: number;
  description: string;
  amount: number;
  balance?: number;
  hold?: boolean;
  mcc?: number;
  operationAmount?: { amount: number; currency: number };
};

function headers(token: string): Record<string, string> {
  return {
    "X-Token": token,
    "Content-Type": "application/json",
  };
}

/** GET /personal/client-info — не частіше 1 раз на 60 секунд */
export async function fetchClientInfo(token: string): Promise<MonobankClientInfo> {
  const res = await fetch(`${MONOBANK_API_BASE}/personal/client-info`, {
    method: "GET",
    headers: headers(token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`monobank client-info: ${res.status} ${text}`);
  }
  return res.json();
}

/** POST /personal/webhook — встановити URL для отримання подій StatementItem */
export async function setWebhook(token: string, webHookUrl: string): Promise<void> {
  const res = await fetch(`${MONOBANK_API_BASE}/personal/webhook`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ webHookUrl }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`monobank setWebhook: ${res.status} ${text}`);
  }
}

/** GET /personal/webhook — поточна адреса вебхука (не споживає ліміт client-info 1/60с) */
export async function getWebhook(token: string): Promise<string> {
  const res = await fetch(`${MONOBANK_API_BASE}/personal/webhook`, {
    method: "GET",
    headers: headers(token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`monobank getWebhook: ${res.status} ${text}`);
  }
  const text = await res.text();
  if (!text || !text.trim()) return "";
  try {
    const j = JSON.parse(text) as unknown;
    const url = typeof j === "string" ? j : (j as { webHookUrl?: string })?.webHookUrl ?? "";
    return String(url).trim();
  } catch {
    return text.replace(/^"|"$/g, "").trim();
  }
}

/** DELETE /personal/webhook — вимкнути вебхук */
export async function deleteWebhook(token: string): Promise<void> {
  const res = await fetch(`${MONOBANK_API_BASE}/personal/webhook`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`monobank deleteWebhook: ${res.status} ${text}`);
  }
}

/** GET /personal/statement/{account}/{from}/{to} — виписка (макс 31 діб+1год, 1 раз/60с, до 500 транзакцій) */
export async function fetchStatement(
  token: string,
  account: string,
  from: number,
  to: number
): Promise<MonobankStatementItem[]> {
  const res = await fetch(
    `${MONOBANK_API_BASE}/personal/statement/${account}/${from}/${to}`,
    { method: "GET", headers: headers(token) }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`monobank statement: ${res.status} ${text}`);
  }
  return res.json();
}
