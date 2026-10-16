"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";

type Recipient = { id: string; name: string; telegramChatId: string; enabled: boolean };
type Rule = {
  id: string;
  databaseId: string;
  eventType: string;
  propertyId: string | null;
  recipientId: string;
  enabled: boolean;
};
type PropertyOption = { id: string; name: string; databaseId: string };
type JournalEvent = {
  id: string;
  notionEventId: string;
  eventType: string;
  pageId: string | null;
  databaseId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
};
type DatabaseOption = { id: string; label: string };
type Overview = {
  ok: boolean;
  canEdit: boolean;
  webhookUrl: string;
  env: {
    notionToken: boolean;
    verificationToken: boolean;
    telegramBotToken: boolean;
    defaultChatId: boolean;
  };
  verificationToken: string | null;
  databases: DatabaseOption[];
  eventLabels: Record<string, string>;
  recipients: Recipient[];
  rules: Rule[];
  properties: PropertyOption[];
  events: JournalEvent[];
  error?: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "очікує",
  processing: "обробляється",
  processed: "оброблено",
  skipped: "пропущено",
  failed: "помилка",
};

const inputStyle: CSSProperties = {
  border: "1px solid #d7dbe3",
  borderRadius: 10,
  padding: "8px 10px",
  fontSize: 14,
  width: "100%",
  background: "#fff",
};

const buttonStyle: CSSProperties = {
  border: 0,
  borderRadius: 10,
  padding: "8px 12px",
  background: "#1f2937",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};

export default function NotionAdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [chatId, setChatId] = useState("");
  const [ruleDatabase, setRuleDatabase] = useState("*");
  const [ruleEvent, setRuleEvent] = useState("page.properties_updated");
  const [ruleProperty, setRuleProperty] = useState("");
  const [ruleRecipient, setRuleRecipient] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/notion", { credentials: "include" });
    const json = (await response.json()) as Overview;
    if (!response.ok) {
      setError(json.error || "Не вдалося відкрити розділ Notion");
      return;
    }
    setData(json);
    setError("");
    setRuleRecipient((current) => current || json.recipients[0]?.id || "");
  }, []);

  useEffect(() => {
    load().catch(() => setError("Не вдалося відкрити розділ Notion"));
  }, [load]);

  const editable = Boolean(data?.canEdit);
  const properties = useMemo(() => {
    const list = data?.properties || [];
    if (ruleDatabase === "*") return list;
    return list.filter((item) => item.databaseId === ruleDatabase);
  }, [data?.properties, ruleDatabase]);

  async function call(url: string, method: string, body?: unknown) {
    const response = await fetch(url, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || "Запит не вдався");
    return json;
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
  }

  async function addRecipient(event: FormEvent) {
    event.preventDefault();
    setBusy("recipient");
    try {
      await call("/api/admin/notion/recipients", "POST", { name, telegramChatId: chatId });
      setName("");
      setChatId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося додати отримувача");
    } finally {
      setBusy("");
    }
  }

  async function saveRecipient(recipient: Recipient, patch: Partial<Recipient>) {
    setBusy(recipient.id);
    try {
      await call(`/api/admin/notion/recipients/${recipient.id}`, "PATCH", patch);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося зберегти отримувача");
    } finally {
      setBusy("");
    }
  }

  async function removeRecipient(recipient: Recipient) {
    if (!window.confirm(`Видалити отримувача ${recipient.name}? Правила для нього теж зникнуть.`)) return;
    setBusy(recipient.id);
    try {
      await call(`/api/admin/notion/recipients/${recipient.id}`, "DELETE");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося видалити отримувача");
    } finally {
      setBusy("");
    }
  }

  async function sendTest(recipient: Recipient) {
    setBusy(`test-${recipient.id}`);
    try {
      await call("/api/admin/notion/test-message", "POST", { recipientId: recipient.id });
      setError("");
      window.alert(`Тест надіслано: ${recipient.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Тест не пішов");
    } finally {
      setBusy("");
    }
  }

  async function addRule(event: FormEvent) {
    event.preventDefault();
    setBusy("rule");
    try {
      await call("/api/admin/notion/rules", "POST", {
        databaseId: ruleDatabase,
        eventType: ruleEvent,
        propertyId: ruleProperty,
        recipientId: ruleRecipient,
      });
      setRuleProperty("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося додати правило");
    } finally {
      setBusy("");
    }
  }

  async function toggleRule(rule: Rule) {
    setBusy(rule.id);
    try {
      await call(`/api/admin/notion/rules/${rule.id}`, "PATCH", { enabled: !rule.enabled });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося змінити правило");
    } finally {
      setBusy("");
    }
  }

  async function removeRule(rule: Rule) {
    if (!window.confirm("Видалити це правило?")) return;
    setBusy(rule.id);
    try {
      await call(`/api/admin/notion/rules/${rule.id}`, "DELETE");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося видалити правило");
    } finally {
      setBusy("");
    }
  }

  const databases = data?.databases || [];
  const labels = data?.eventLabels || {};

  return (
    <main style={{ maxWidth: 980, margin: "32px auto", padding: "0 20px 64px" }}>
      <p style={{ margin: "0 0 12px" }}>
        <Link href="/admin" style={{ color: "#2457c5" }}>← Адмінка</Link>
      </p>
      <h1 style={{ fontSize: 36, fontWeight: 800, margin: "0 0 8px" }}>Notion</h1>
      <p style={{ margin: "0 0 20px", color: "rgba(0,0,0,0.6)" }}>
        Підключення баз задач і правила, кому слати сповіщення в Telegram.
      </p>
      {error && (
        <p style={{ background: "#fff1f0", color: "#9f1239", borderRadius: 12, padding: "10px 12px" }}>{error}</p>
      )}

      <section style={cardStyle}>
        <h2 style={headingStyle}>Підключення</h2>
        <p style={{ marginTop: 0 }}>
          У Notion, у вкладці Webhooks інтеграції, встав цей URL. Події: нова сторінка, зміна властивостей, видалення, відновлення.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input readOnly value={data?.webhookUrl || "https://p-3-0.vercel.app/api/notion/webhook"} style={inputStyle} />
          <button type="button" style={buttonStyle} onClick={() => copy(data?.webhookUrl || "https://p-3-0.vercel.app/api/notion/webhook")}>
            Копіювати
          </button>
        </div>
        <ul style={{ paddingLeft: 18, lineHeight: 1.6 }}>
          <li>NOTION_TOKEN: {flag(data?.env.notionToken)}</li>
          <li>NOTION_WEBHOOK_VERIFICATION_TOKEN: {flag(data?.env.verificationToken)}</li>
          <li>TELEGRAM_NOTION_BOT_TOKEN: {flag(data?.env.telegramBotToken)}</li>
          <li>DEFAULT_TELEGRAM_CHAT_ID: {flag(data?.env.defaultChatId)}</li>
        </ul>
        <p style={{ marginBottom: 8 }}>
          Після створення підписки Notion один раз пришле токен верифікації. Скопіюй його в змінну Vercel NOTION_WEBHOOK_VERIFICATION_TOKEN і натисни Verify у Notion.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            readOnly
            value={data?.verificationToken || "Notion ще не надсилав токен"}
            style={inputStyle}
          />
          <button
            type="button"
            style={buttonStyle}
            disabled={!data?.verificationToken}
            onClick={() => data?.verificationToken && copy(data.verificationToken)}
          >
            Копіювати токен
          </button>
        </div>
        <ol style={{ paddingLeft: 18, color: "rgba(0,0,0,0.75)" }}>
          <li>Створи внутрішню інтеграцію Notion і вмикни Read content.</li>
          <li>На базах «Задачі маркетингу» і «Операційні задачі» додай інтеграцію в Connections.</li>
          <li>Створи підписку на URL вище і підтверди її токеном з цього екрана.</li>
        </ol>
      </section>

      <section style={cardStyle}>
        <h2 style={headingStyle}>Отримувачі</h2>
        {(data?.recipients || []).map((recipient) => (
          <RecipientRow
            key={recipient.id}
            recipient={recipient}
            disabled={!editable || busy === recipient.id || busy === `test-${recipient.id}`}
            onSave={(patch) => saveRecipient(recipient, patch)}
            onDelete={() => removeRecipient(recipient)}
            onTest={() => sendTest(recipient)}
          />
        ))}
        {editable && (
          <form onSubmit={addRecipient} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginTop: 12 }}>
            <input style={inputStyle} placeholder="Ім’я" value={name} onChange={(event) => setName(event.target.value)} />
            <input style={inputStyle} placeholder="Telegram chat id" value={chatId} onChange={(event) => setChatId(event.target.value)} />
            <button style={buttonStyle} disabled={busy === "recipient"}>Додати</button>
          </form>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={headingStyle}>Правила</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {["База", "Подія", "Поле", "Отримувач", "Увімкнено", ""].map((title) => (
                  <th key={title} style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e8ebf0" }}>{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.rules || []).map((rule) => {
                const recipient = data?.recipients.find((item) => item.id === rule.recipientId);
                const property = data?.properties.find((item) => item.id === rule.propertyId);
                return (
                  <tr key={rule.id}>
                    <td style={cellStyle}>{rule.databaseId === "*" ? "Усі бази" : databases.find((item) => item.id === rule.databaseId)?.label || rule.databaseId}</td>
                    <td style={cellStyle}>{labels[rule.eventType] || rule.eventType}</td>
                    <td style={cellStyle}>{rule.propertyId ? property?.name || rule.propertyId : "будь-яке"}</td>
                    <td style={cellStyle}>{recipient?.name || "видалений"}</td>
                    <td style={cellStyle}>
                      <input type="checkbox" checked={rule.enabled} disabled={!editable || busy === rule.id} onChange={() => toggleRule(rule)} />
                    </td>
                    <td style={cellStyle}>
                      {editable && (
                        <button type="button" style={quietButton} onClick={() => removeRule(rule)}>Видалити</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && (
          <form onSubmit={addRule} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginTop: 14 }}>
            <select style={inputStyle} value={ruleDatabase} onChange={(event) => setRuleDatabase(event.target.value)}>
              <option value="*">Усі бази</option>
              {databases.map((database) => (
                <option key={database.id} value={database.id}>{database.label}</option>
              ))}
            </select>
            <select style={inputStyle} value={ruleEvent} onChange={(event) => setRuleEvent(event.target.value)}>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select style={inputStyle} value={ruleProperty} onChange={(event) => setRuleProperty(event.target.value)} disabled={ruleEvent !== "page.properties_updated" && ruleEvent !== "*"}>
              <option value="">Будь-яке поле</option>
              {properties.map((property) => (
                <option key={`${property.databaseId}:${property.id}`} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
            <select style={inputStyle} value={ruleRecipient} onChange={(event) => setRuleRecipient(event.target.value)} required>
              <option value="">Отримувач</option>
              {(data?.recipients || []).map((recipient) => (
                <option key={recipient.id} value={recipient.id}>{recipient.name}</option>
              ))}
            </select>
            <button style={buttonStyle} disabled={busy === "rule" || !ruleRecipient}>Додати правило</button>
          </form>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={headingStyle}>Журнал</h2>
        {(data?.events || []).length === 0 && <p style={{ color: "rgba(0,0,0,0.55)" }}>Подій ще немає.</p>}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <tbody>
              {(data?.events || []).map((event) => (
                <tr key={event.id}>
                  <td style={cellStyle}>{new Date(event.createdAt).toLocaleString("uk-UA")}</td>
                  <td style={cellStyle}>{labels[event.eventType] || event.eventType}</td>
                  <td style={cellStyle}>{event.databaseId ? databases.find((item) => item.id === event.databaseId)?.label || event.databaseId : "—"}</td>
                  <td style={cellStyle}>{STATUS_LABELS[event.status] || event.status}</td>
                  <td style={cellStyle}>{event.error || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function RecipientRow({
  recipient,
  disabled,
  onSave,
  onDelete,
  onTest,
}: {
  recipient: Recipient;
  disabled: boolean;
  onSave: (patch: Partial<Recipient>) => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const [name, setName] = useState(recipient.name);
  const [chatId, setChatId] = useState(recipient.telegramChatId);
  useEffect(() => {
    setName(recipient.name);
    setChatId(recipient.telegramChatId);
  }, [recipient.name, recipient.telegramChatId]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, alignItems: "center", marginBottom: 8 }}>
      <input style={inputStyle} value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} />
      <input style={inputStyle} value={chatId} disabled={disabled} onChange={(event) => setChatId(event.target.value)} />
      <label style={{ fontSize: 13 }}>
        <input
          type="checkbox"
          checked={recipient.enabled}
          disabled={disabled}
          onChange={(event) => onSave({ enabled: event.target.checked })}
        />{" "}
        увімкнено
      </label>
      <button type="button" style={quietButton} disabled={disabled} onClick={() => onSave({ name, telegramChatId: chatId })}>Зберегти</button>
      <button type="button" style={quietButton} disabled={disabled} onClick={onTest}>Тест</button>
      <button type="button" style={quietButton} disabled={disabled} onClick={onDelete}>Видалити</button>
    </div>
  );
}

function flag(value: boolean | undefined) {
  if (value == null) return "…";
  return value ? "задано" : "немає";
}

const cardStyle: CSSProperties = {
  background: "#fff",
  border: "1px solid #e8ebf0",
  borderRadius: 18,
  padding: 18,
  marginBottom: 16,
  boxShadow: "0 8px 26px rgba(0,0,0,0.04)",
};

const headingStyle: CSSProperties = { margin: "0 0 12px", fontSize: 22 };
const cellStyle: CSSProperties = { padding: "8px 6px", borderBottom: "1px solid #f0f2f5", verticalAlign: "top" };
const quietButton: CSSProperties = {
  border: "1px solid #d7dbe3",
  background: "#fff",
  borderRadius: 10,
  padding: "8px 10px",
  cursor: "pointer",
};
