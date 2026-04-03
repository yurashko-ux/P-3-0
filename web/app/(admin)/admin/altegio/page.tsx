// web/app/(admin)/admin/altegio/page.tsx
"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function AltegioLanding() {
  const [testStatus, setTestStatus] = useState<{
    loading: boolean;
    ok: boolean | null;
    message?: string;
    companiesCount?: number;
    companies?: Array<{ id: number; name: string; [key: string]: any }>;
    error?: string;
    env?: any;
    imagePngDebug?: any;
    debug?: any;
    programType?: string;
    recommendation?: string;
  }>({ loading: false, ok: null });
  
  const [clientsTestStatus, setClientsTestStatus] = useState<{
    loading: boolean;
    ok: boolean | null;
    message?: string;
    clientsCount?: number;
    clients?: Array<{ id: number; name: string; phone?: string; email?: string }>;
    firstClientStructure?: any;
    instagramFieldFound?: boolean;
    instagramFieldName?: string | null;
    instagramFieldValue?: string | null;
    allKeys?: string[];
    customFields?: string[];
    error?: string;
  }>({ loading: false, ok: null });
  
  const [appointmentsTestStatus, setAppointmentsTestStatus] = useState<{
    loading: boolean;
    ok: boolean | null;
    message?: string;
    appointmentsCount?: number;
    appointmentsWithInstagram?: number;
    appointments?: Array<{
      id: number;
      datetime: string;
      client_name: string;
      instagram_username?: string | null;
      status?: string;
    }>;
    days?: number;
    error?: string;
  }>({ loading: false, ok: null });

  const [fullWeekAppointmentsStatus, setFullWeekAppointmentsStatus] = useState<{
    loading: boolean;
    ok: boolean | null;
    data?: any;
    error?: string;
  }>({ loading: false, ok: null });

  const [remindersQueue, setRemindersQueue] = useState<{
    loading: boolean;
    ok: boolean | null;
    jobs?: Array<{
      id: string;
      clientName: string;
      instagram: string | null;
      visitDateTime: string;
      dueAtFormatted: string;
      daysUntilVisit: number;
      status: string;
      serviceTitle: string | null;
      staffName: string | null;
    }>;
    debug?: {
      indexTotal: number;
      jobsBeforeFilter: number;
      jobsAfterFilter: number;
      now: string;
    };
    error?: string;
  }>({ loading: false, ok: null });

  const [remindersDebug, setRemindersDebug] = useState<{
    loading: boolean;
    ok: boolean | null;
    data?: any;
    error?: string;
  }>({ loading: false, ok: null });

  const [sentReminders, setSentReminders] = useState<{
    loading: boolean;
    ok: boolean | null;
    logs?: Array<{
      timestamp: number;
      timestampFormatted: string;
      jobId: string;
      visitId: number;
      instagram: string;
      clientName: string;
      message: string;
      visitDateTime: string;
      visitDateTimeFormatted: string;
      ruleId: string;
      success: boolean;
      messageId?: string;
      error?: string;
    }>;
    total?: number;
    error?: string;
  }>({ loading: false, ok: null });

  const [reminderRules, setReminderRules] = useState<{
    loading: boolean;
    ok: boolean | null;
    rules?: Array<{
      id: string;
      daysBefore: number;
      active: boolean;
      channel: string;
      template: string;
    }>;
    error?: string;
  }>({ loading: false, ok: null });
  
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [bankAccountsTestStatus, setBankAccountsTestStatus] = useState<{
    loading: boolean;
    ok: boolean | null;
    error?: string;
    summary?: {
      altegioAccountsCount: number;
      bankAccountsCount: number;
      matchedCount: number;
      missingBalanceCount: number;
      errorsCount: number;
    };
    altegioAccounts?: Array<{
      id: string;
      title: string;
      type: string | null;
      balance: string | null;
      hasBalance: boolean;
      balanceSource: "api" | "transactions-fallback" | "missing";
    }>;
    bankAccounts?: Array<{
      bankAccountId: string;
      connectionId: string;
      provider: string;
      connectionName: string;
      clientName: string | null;
      externalId: string;
      currencyCode: number;
      type: string | null;
      accountLast4: string;
      bankBalance: string;
      savedMatch: {
        altegioAccountId: string | null;
        altegioAccountTitle: string | null;
        altegioBalance: string | null;
        altegioBalanceUpdatedAt: string | null;
        altegioSyncError: string | null;
      };
      diagnostics: {
        inputTokens: string[];
        matchedTokens: string[];
        matchSource: "saved-account-id" | "title-tokens" | "none";
        error: string | null;
        matchedAccount: {
          id: string;
          title: string;
          type: string | null;
          balance: string | null;
          hasBalance: boolean;
          balanceSource: "api" | "transactions-fallback" | "missing";
        } | null;
      };
    }>;
  }>({ loading: false, ok: null });
  const [bankSyncLoadingById, setBankSyncLoadingById] = useState<Record<string, boolean>>({});
  const [clientsDebug, setClientsDebug] = useState<any>(null);
  const [clientsDebugLoading, setClientsDebugLoading] = useState(false);
  const [diagnosticsModal, setDiagnosticsModal] = useState<{
    open: boolean;
    title: string;
    content: string;
    jsonData?: any;
  }>({
    open: false,
    title: '',
    content: '',
  });
  const [selectedClientDetails, setSelectedClientDetails] = useState<any>(null);
  const [selectedClientLoading, setSelectedClientLoading] = useState(false);
  const [instagramSearchValue, setInstagramSearchValue] = useState<string>('');
  const [instagramSearchResult, setInstagramSearchResult] = useState<{
    loading: boolean;
    ok: boolean | null;
    client?: {
      id: number;
      name: string;
      phone?: string;
      email?: string;
      instagramUsername?: string;
    };
    error?: string;
    diagnostics?: {
      searchedClients: number;
      clientsWithEmail: number;
      clientsWithoutEmail: number;
    };
    similarMatches?: Array<{
      id: number;
      name: string;
      email: string;
      instagramPart: string;
    }>;
    sampleEmails?: Array<{
      id: number;
      name: string;
      email: string;
      instagramPart: string;
    }>;
  }>({ loading: false, ok: null });

  useEffect(() => {
    // Завжди використовуємо production URL для webhook
    // Webhook має бути на стабільному production домені
    const productionWebhookUrl = 'https://p-3-0.vercel.app/api/altegio/webhook';
    setWebhookUrl(productionWebhookUrl);
  }, []);

  async function copyWebhookUrl() {
    if (webhookUrl) {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function testConnection() {
    setTestStatus({ loading: true, ok: null });
    try {
      const res = await fetch('/api/altegio/test', { cache: 'no-store' });
      const data = await res.json();
      setTestStatus({
        loading: false,
        ok: data.ok === true,
        message: data.message || data.error,
        companiesCount: data.count,
        companies: data.companies || [],
        error: data.error,
        env: data.env,
        debug: data.debug,
        programType: data.programType,
        recommendation: data.recommendation,
      });
    } catch (err) {
      setTestStatus({
        loading: false,
        ok: false,
        message: 'Помилка з\'єднання',
        error: err instanceof Error ? err.message : 'Невідома помилка',
      });
    }
  }

  async function getDiagnostics() {
    setDiagnostics(null);
    try {
      const res = await fetch('/api/altegio/diagnostics', { cache: 'no-store' });
      const data = await res.json();
      if (data.ok && data.diagnostics) {
        setDiagnostics(data.diagnostics);
      }
    } catch (err) {
      console.error('Failed to get diagnostics:', err);
    }
  }

  async function copyDiagnostics() {
    if (diagnostics) {
      const diagnosticsText = JSON.stringify(diagnostics, null, 2);
      await navigator.clipboard.writeText(diagnosticsText);
      setDiagnosticsCopied(true);
      setTimeout(() => setDiagnosticsCopied(false), 2000);
    }
  }

  async function testBankAccountsMatch() {
    setBankAccountsTestStatus({ loading: true, ok: null });
    try {
      const res = await fetch('/api/admin/altegio/bank-accounts-test', { cache: 'no-store' });
      const data = await res.json();
      setBankAccountsTestStatus({
        loading: false,
        ok: data.ok === true,
        error: data.error,
        summary: data.summary,
        altegioAccounts: data.altegioAccounts || [],
        bankAccounts: data.bankAccounts || [],
      });
    } catch (err) {
      setBankAccountsTestStatus({
        loading: false,
        ok: false,
        error: err instanceof Error ? err.message : 'Невідома помилка',
      });
    }
  }

  async function syncBankAccount(bankAccountId: string) {
    setBankSyncLoadingById((prev) => ({ ...prev, [bankAccountId]: true }));
    try {
      const res = await fetch('/api/admin/altegio/bank-accounts-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccountId }),
      });
      const data = await res.json();

      if (!data.ok) {
        alert(`❌ Помилка синхронізації:\n${data.error || 'Невідома помилка'}`);
        return;
      }

      const result = data.result || {};
      const status = result.status || 'unknown';
      const message =
        status === 'success'
          ? `✅ Синхронізація успішна\n\nРахунок Altegio: ${result.altegioAccountTitle || '—'}\nБаланс: ${result.altegioBalance || '—'}`
          : status === 'warning'
            ? `⚠️ Є попередження\n\n${result.reason || 'Невідома причина'}`
            : `ℹ️ Синхронізацію пропущено\n\n${result.reason || 'Невідома причина'}`;

      alert(message);
      await testBankAccountsMatch();
    } catch (err) {
      alert(`❌ Помилка синхронізації:\n${err instanceof Error ? err.message : 'Невідома помилка'}`);
    } finally {
      setBankSyncLoadingById((prev) => ({ ...prev, [bankAccountId]: false }));
    }
  }

  async function testClients() {
    setClientsTestStatus({ loading: true, ok: null });
    try {
      const res = await fetch('/api/altegio/test/clients', { cache: 'no-store' });
      const data = await res.json();
      setClientsTestStatus({
        loading: false,
        ok: data.ok === true,
        message: data.message || data.error,
        clientsCount: data.clientsCount,
        clients: data.clients || [],
        firstClientStructure: data.firstClientStructure,
        instagramFieldFound: data.instagramFieldFound,
        instagramFieldName: data.instagramFieldName,
        instagramFieldValue: data.instagramFieldValue,
        allKeys: data.allKeys,
        customFields: data.customFields,
        error: data.error,
      });
    } catch (err) {
      setClientsTestStatus({
        loading: false,
        ok: false,
        message: 'Помилка з\'єднання',
        error: err instanceof Error ? err.message : 'Невідома помилка',
      });
    }
  }

  async function testClientsDebug() {
    setClientsDebugLoading(true);
    setClientsDebug(null);
    try {
      const res = await fetch('/api/altegio/test/clients-debug', { cache: 'no-store' });
      const data = await res.json();
      setClientsDebug(data);
    } catch (err) {
      setClientsDebug({
        ok: false,
        error: err instanceof Error ? err.message : 'Невідома помилка',
      });
    } finally {
      setClientsDebugLoading(false);
    }
  }

  async function getClientDetails(clientId: number) {
    setSelectedClientLoading(true);
    setSelectedClientDetails(null);
    try {
      const res = await fetch(`/api/altegio/test/clients/${clientId}`, { cache: 'no-store' });
      const data = await res.json();
      setSelectedClientDetails(data);
    } catch (err) {
      setSelectedClientDetails({
        ok: false,
        error: err instanceof Error ? err.message : 'Невідома помилка',
      });
    } finally {
      setSelectedClientLoading(false);
    }
  }

  async function searchClientByInstagram() {
    if (!instagramSearchValue.trim()) {
      return;
    }
    
    setInstagramSearchResult({ loading: true, ok: null });
    try {
      const res = await fetch(
        `/api/altegio/test/clients/by-instagram?instagram=${encodeURIComponent(instagramSearchValue.trim())}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      
      if (data.ok && data.client) {
        setInstagramSearchResult({
          loading: false,
          ok: true,
          client: data.client,
        });
      } else {
        setInstagramSearchResult({
          loading: false,
          ok: false,
          error: data.error || 'Клієнт не знайдено',
          diagnostics: data.diagnostics,
          similarMatches: data.similarMatches,
          sampleEmails: data.sampleEmails,
        });
      }
    } catch (err) {
      setInstagramSearchResult({
        loading: false,
        ok: false,
        error: err instanceof Error ? err.message : 'Невідома помилка',
      });
    }
  }

  async function testAppointments() {
    setAppointmentsTestStatus({ loading: true, ok: null });
    try {
      const res = await fetch('/api/altegio/test/appointments?days=30', { cache: 'no-store' });
      const data = await res.json();
      setAppointmentsTestStatus({
        loading: false,
        ok: data.ok === true,
        message: data.message || data.error,
        appointmentsCount: data.appointmentsCount,
        appointmentsWithInstagram: data.appointmentsWithInstagram,
        appointments: data.appointments || [],
        days: data.days,
        error: data.error,
      });
    } catch (err) {
      setAppointmentsTestStatus({
        loading: false,
        ok: false,
        message: 'Помилка з\'єднання з API записів',
        error: err instanceof Error ? err.message : 'Невідома помилка',
      });
    }
  }

  async function testFullWeekAppointments() {
    setFullWeekAppointmentsStatus({ loading: true, ok: null });
    try {
      const res = await fetch('/api/altegio/test/appointments/full-week', { cache: 'no-store' });
      const data = await res.json();
      setFullWeekAppointmentsStatus({
        loading: false,
        ok: data.ok === true,
        data: data,
        error: data.error,
      });
    } catch (err) {
      setFullWeekAppointmentsStatus({
        loading: false,
        ok: false,
        error: err instanceof Error ? err.message : 'Невідома помилка',
      });
    }
  }

  async function loadRemindersQueue(status: 'pending' | 'all' = 'pending') {
    setRemindersQueue({ loading: true, ok: null });
    try {
      const res = await fetch(`/api/altegio/reminders/queue?status=${status}&limit=50`, { cache: 'no-store' });
      const data = await res.json();
      setRemindersQueue({
        loading: false,
        ok: data.ok === true,
        jobs: data.jobs || [],
        debug: data.debug,
        error: data.error,
      });
    } catch (err) {
      setRemindersQueue({
        loading: false,
        ok: false,
        error: err instanceof Error ? err.message : 'Невідома помилка',
      });
    }
  }

  async function loadRemindersDebug() {
    setRemindersDebug({ loading: true, ok: null, data: undefined, error: undefined });
    try {
      const res = await fetch('/api/altegio/reminders/debug', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      setRemindersDebug({
        loading: false,
        ok: data.ok === true,
        data: data.diagnostics,
        error: data.error,
      });
    } catch (err) {
      console.error('[loadRemindersDebug] Error:', err);
      setRemindersDebug({
        loading: false,
        ok: false,
        error: err instanceof Error ? err.message : 'Невідома помилка',
        data: undefined,
      });
    }
  }

  async function loadSentReminders() {
    setSentReminders({ loading: true, ok: null, logs: undefined, error: undefined });
    try {
      const res = await fetch('/api/altegio/reminders/sent?limit=50', { cache: 'no-store' });
      const data = await res.json();
      setSentReminders({
        loading: false,
        ok: data.ok === true,
        logs: data.logs || [],
        total: data.total || 0,
        error: data.error,
      });
    } catch (err) {
      setSentReminders({
        loading: false,
        ok: false,
        error: err instanceof Error ? err.message : 'Невідома помилка',
        logs: undefined,
      });
    }
  }

  async function loadReminderRules() {
    setReminderRules({ loading: true, ok: null, rules: undefined, error: undefined });
    try {
      const res = await fetch('/api/altegio/reminders/rules', { cache: 'no-store' });
      const data = await res.json();
      setReminderRules({
        loading: false,
        ok: data.ok === true,
        rules: data.rules || [],
        error: data.error,
      });
    } catch (err) {
      setReminderRules({
        loading: false,
        ok: false,
        error: err instanceof Error ? err.message : 'Невідома помилка',
        rules: undefined,
      });
    }
  }

  async function saveReminderRules() {
    if (!reminderRules.rules) return;
    
    setReminderRules({ ...reminderRules, loading: true });
    try {
      const res = await fetch('/api/altegio/reminders/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: reminderRules.rules }),
      });
      const data = await res.json();
      if (data.ok) {
        setReminderRules({
          loading: false,
          ok: true,
          rules: data.rules || reminderRules.rules,
          error: undefined,
        });
        alert('✅ Шаблони повідомлень збережено!');
      } else {
        setReminderRules({
          ...reminderRules,
          loading: false,
          ok: false,
          error: data.error,
        });
        alert(`❌ Помилка: ${data.error}`);
      }
    } catch (err) {
      setReminderRules({
        ...reminderRules,
        loading: false,
        ok: false,
        error: err instanceof Error ? err.message : 'Невідома помилка',
      });
      alert(`❌ Помилка: ${err instanceof Error ? err.message : 'Невідома помилка'}`);
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: '48px auto', padding: '0 20px' }}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: -0.5, margin: 0 }}>
          Альтеджіо · аналітика
        </h1>
        <p style={{ marginTop: 10, color: 'rgba(0,0,0,0.55)' }}>
          Модуль у розробці: синхронізація Alteg.io, план/факт, склад волосся, нагадування.
        </p>
      </header>

      <section style={{ display: 'grid', gap: 18 }}>
        <Card title="Підключення до API" emoji="🔌">
          <div style={{ marginBottom: 16 }}>
            <p style={{ marginBottom: 12 }}>
              Перевірка підключення до Alteg.io API з використанням USER_TOKEN.
            </p>
            <button
              onClick={testConnection}
              disabled={testStatus.loading}
              style={{
                padding: '10px 20px',
                background: '#2a6df5',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                cursor: testStatus.loading ? 'not-allowed' : 'pointer',
                opacity: testStatus.loading ? 0.6 : 1,
              }}
            >
              {testStatus.loading ? 'Перевірка...' : 'Тестувати підключення'}
            </button>
          </div>

          <div style={{ marginTop: 16, padding: 12, background: '#f3f5f9', borderRadius: 8 }}>
            <p style={{ margin: 0, marginBottom: 8, fontWeight: 600 }}>
              URL для webhook в налаштуваннях Alteg.io:
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <code
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: '#fff',
                  borderRadius: 6,
                  border: '1px solid #e8ebf0',
                  fontSize: '0.9em',
                  wordBreak: 'break-all',
                  display: 'block',
                }}
              >
                {webhookUrl || '/api/altegio/webhook'}
              </code>
              <button
                onClick={copyWebhookUrl}
                style={{
                  padding: '8px 16px',
                  background: copied ? '#22c55e' : '#2a6df5',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.2s',
                }}
              >
                {copied ? '✓ Скопійовано' : 'Скопіювати'}
              </button>
            </div>
            <p style={{ margin: '8px 0 0 0', fontSize: '0.9em', color: 'rgba(0,0,0,0.6)' }}>
              Скопіюйте цю адресу та вкажіть її в полі <strong>"Адреса для надсилання повідомлень"</strong> в налаштуваннях маркетплейсу Alteg.io (розділ "Налаштування для розробки").
            </p>
          </div>

          {testStatus.ok !== null && (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: testStatus.ok ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${testStatus.ok ? '#86efac' : '#fca5a5'}`,
                color: testStatus.ok ? '#166534' : '#991b1b',
              }}
            >
              <strong>{testStatus.ok ? '✅ Успішно' : '❌ Помилка'}:</strong>{' '}
              {testStatus.message}
              {testStatus.companiesCount !== undefined && (
                <div style={{ marginTop: 8 }}>
                  Знайдено компаній: <strong>{testStatus.companiesCount}</strong>
                </div>
              )}
              {testStatus.ok && testStatus.companies && testStatus.companies.length > 0 && (
                <div style={{ marginTop: 16, padding: 12, background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd' }}>
                  <strong style={{ display: 'block', marginBottom: 12 }}>📋 Список компаній (філій/салонів):</strong>
                  <div style={{ maxHeight: '400px', overflowY: 'auto', fontSize: '0.9em' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e0e7ef', textAlign: 'left' }}>
                          <th style={{ padding: '8px 12px', fontWeight: 600 }}>ID</th>
                          <th style={{ padding: '8px 12px', fontWeight: 600 }}>Назва</th>
                          <th style={{ padding: '8px 12px', fontWeight: 600 }}>Статус</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testStatus.companies.slice(0, 50).map((company: any, index: number) => (
                          <tr 
                            key={company.id || index} 
                            style={{ 
                              borderBottom: '1px solid #f0f0f0',
                              backgroundColor: index % 2 === 0 ? '#fff' : '#fafafa'
                            }}
                          >
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '0.85em' }}>
                              {company.id || company.company_id || 'N/A'}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              {company.name || company.public_title || company.title || 'Без назви'}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              {company.active !== undefined ? (
                                (company.active === true || company.active === 1) ? (
                                  <span style={{ color: '#22c55e', fontWeight: 600 }}>✅ Активна</span>
                                ) : (
                                  <span style={{ color: '#ef4444', fontWeight: 600 }}>❌ Неактивна</span>
                                )
                              ) : (
                                <span style={{ color: '#6b7280' }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {testStatus.companies.length > 50 && (
                      <p style={{ marginTop: 12, fontSize: '0.85em', color: '#6b7280', textAlign: 'center' }}>
                        Показано перші 50 з {testStatus.companies.length} компаній
                      </p>
                    )}
                  </div>
                  {testStatus.companiesCount && testStatus.companiesCount !== testStatus.companies.length && (
                    <p style={{ marginTop: 8, fontSize: '0.85em', color: '#6b7280' }}>
                      ⚠️ Увага: API повернув {testStatus.companies.length} компаній, але count = {testStatus.companiesCount}
                    </p>
                  )}
                  {testStatus.companies && testStatus.companies.length > 1 && (
                    <div style={{ marginTop: 12, padding: 12, background: '#fff3cd', borderRadius: 6, border: '1px solid #ffc107' }}>
                      <strong>💡 Якщо серед компаній є ваш салон:</strong>
                      <p style={{ margin: '8px 0 0 0', fontSize: '0.9em' }}>
                        Якщо ви бачите тут більше компаній, ніж очікували, це означає, що API повертає всі компанії, до яких має доступ ваш User Token.
                      </p>
                      <p style={{ margin: '8px 0 0 0', fontSize: '0.9em', fontWeight: 600 }}>
                        Щоб показувати тільки ваш салон:
                      </p>
                      <ol style={{ margin: '8px 0 0 0', paddingLeft: 20, fontSize: '0.9em' }}>
                        <li>Знайдіть ID вашого салону в таблиці вище</li>
                        <li>Додайте змінну <code>ALTEGIO_COMPANY_ID</code> в Vercel з ID вашого салону</li>
                        <li>Або відфільтруйте компанії за назвою в налаштуваннях</li>
                      </ol>
                      <p style={{ margin: '8px 0 0 0', fontSize: '0.85em', fontStyle: 'italic', color: '#6b7280' }}>
                        Partner ID (784) - це не ID компанії, а ID в маркетплейсі Alteg.io. ID вашої компанії (салону) - це числове значення з колонки "ID" вище.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {testStatus.debug && (
                <div style={{ marginTop: 8, padding: 12, background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd', fontSize: '0.85em' }}>
                  <strong>🔍 Діагностика:</strong>
                  <ul style={{ margin: '4px 0 0 0', paddingLeft: 20 }}>
                    <li>Тип програми: <code>{testStatus.programType || 'Unknown'}</code></li>
                    <li>User Token в env: <code>{testStatus.debug.userTokenInEnv ? '✅ Так' : '❌ Ні'}</code></li>
                    {testStatus.debug.userTokenInEnv && (
                      <li>Довжина User Token: <code>{testStatus.debug.userTokenLength || 0}</code></li>
                    )}
                    <li>Partner Token в env: <code>{testStatus.debug.partnerTokenInEnv ? '✅ Так' : '❌ Ні (OK for non-public)'}</code></li>
                    {testStatus.debug.partnerTokenInEnv && (
                      <li>Довжина Partner Token: <code>{testStatus.debug.partnerTokenLength || 0}</code></li>
                    )}
                    <li>Partner ID в env: <code>{testStatus.debug.partnerIdInEnv ? '✅ Так' : '❌ Ні'}</code></li>
                    {testStatus.debug.partnerIdInEnv && (
                      <>
                        <li>Значення Partner ID: <code>{testStatus.debug.partnerIdValue || 'not set'}</code></li>
                        <li>Довжина Partner ID: <code>{testStatus.debug.partnerIdLength || 0}</code></li>
                      </>
                    )}
                  </ul>
                  {testStatus.debug.partnerTokenInEnv && testStatus.error && testStatus.error.includes('Partner ID') && (
                    <div style={{ marginTop: 12, padding: 12, background: '#fff3cd', borderRadius: 6, border: '1px solid #ffc107' }}>
                      <strong>⚠️ Важливо:</strong>
                      <p style={{ margin: '8px 0 0 0', fontSize: '0.9em' }}>
                        Partner Token все ще знайдено в environment variables, але для <strong>непублічної програми</strong> він не потрібен.
                      </p>
                      <p style={{ margin: '8px 0 0 0', fontSize: '0.9em', fontWeight: 600 }}>
                        Якщо ви видалили ALTEGIO_PARTNER_TOKEN з Vercel, але діагностика все ще показує його:
                      </p>
                      <ol style={{ margin: '8px 0 0 0', paddingLeft: 20, fontSize: '0.9em' }}>
                        <li>Перевірте, чи видалено змінну для правильного середовища (Production/Preview)</li>
                        <li><strong>ОБОВ'ЯЗКОВО перезапустіть деплой</strong> в Vercel (Redeploy)</li>
                        <li>Зачекайте 1-2 хвилини після перезапуску</li>
                      </ol>
                    </div>
                  )}
                  {!testStatus.debug.partnerTokenInEnv && testStatus.programType === 'Non-public (User Token only)' && (
                    <p style={{ margin: '8px 0 0 0', fontSize: '0.9em', color: '#22c55e', fontWeight: 600 }}>
                      ✅ Правильна конфігурація для непублічної програми: тільки User Token
                    </p>
                  )}
                </div>
              )}
              {testStatus.error && (
                <div style={{ marginTop: 8, fontSize: '0.9em', opacity: 0.9 }}>
                  <div style={{ marginBottom: 8 }}>{testStatus.error}</div>
                  {testStatus.recommendation && (
                    <div style={{ marginTop: 12, padding: 12, background: '#fff3cd', borderRadius: 6, border: '1px solid #ffc107' }}>
                      <strong>💡 Рекомендація:</strong>
                      <p style={{ margin: '8px 0 0 0', fontSize: '0.9em' }}>{testStatus.recommendation}</p>
                    </div>
                  )}
                  {(testStatus.error.includes('Partner ID') || testStatus.error.includes('partner') || testStatus.error.includes('401')) && (
                    <div style={{ marginTop: 12, padding: 12, background: '#fff3cd', borderRadius: 6, border: '1px solid #ffc107' }}>
                      <strong>💡 Як знайти Partner ID:</strong>
                      <p style={{ margin: '8px 0', fontSize: '0.9em' }}>
                        Для <strong>непублічних програм</strong> Partner ID - це ID вашої філії/салону в Alteg.io (наприклад, 1169323).
                        API використовує Partner ID, щоб знати, з якої філії брати дані.
                      </p>
                      <p style={{ margin: '8px 0', fontSize: '0.9em', fontWeight: 600 }}>
                        Для публічних програм Partner ID - це Application ID або Partner Token.
                      </p>
                      <p style={{ margin: '8px 0', fontSize: '0.9em', fontWeight: 600 }}>
                        Варіант 1: ID філії/салону з вашої адмінки Alteg.io (для непублічних програм)
                      </p>
                      <ol style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                        <li>Відкрийте вашу адмінку Alteg.io (https://app.alteg.io або https://alteg.io)</li>
                        <li>Перейдіть в налаштування філії/салону</li>
                        <li>Знайдіть <strong>ID філії</strong> (може бути в URL або в налаштуваннях)</li>
                        <li>ID філії зазвичай виглядає як числовий ID (наприклад: 1169323)</li>
                        <li>Скопіюйте його та додайте як змінну середовища <code>ALTEGIO_PARTNER_ID</code> в Vercel</li>
                      </ol>
                      <p style={{ margin: '12px 0 8px 0', fontSize: '0.9em', fontWeight: 600 }}>
                        Варіант 2: Application ID з налаштувань додатку (для публічних програм)
                      </p>
                      <ol style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                        <li>Відкрийте <a href="https://marketplace.alteg.io" target="_blank" rel="noopener noreferrer" style={{ color: '#2a6df5' }}>Alteg.io Marketplace</a></li>
                        <li>Перейдіть в "Мої програми" → ваш додаток</li>
                        <li>Відкрийте розділ <strong>"Загальна інформація"</strong></li>
                        <li>Знайдіть <strong>Application ID</strong> (наприклад: 1193)</li>
                        <li>Скопіюйте його та додайте як змінну середовища <code>ALTEGIO_PARTNER_ID</code> або <code>ALTEGIO_PARTNER_TOKEN</code> в Vercel</li>
                      </ol>
                      <p style={{ margin: '12px 0 8px 0', fontSize: '0.9em', fontWeight: 600 }}>
                        Варіант 2: Partner Token з налаштувань акаунта
                      </p>
                      <ol style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                        <li>Натисніть на "Налаштування облікового запису" (праворуч вгорі)</li>
                        <li>Перейдіть в розділ "Акаунт розробника"</li>
                        <li>Знайдіть поле "Токен партнера" (Partner Token)</li>
                        <li>Якщо є - скопіюйте його</li>
                      </ol>
                      <p style={{ margin: '12px 0 0 0', fontSize: '0.85em', fontStyle: 'italic', background: '#e7f3ff', padding: 8, borderRadius: 4 }}>
                        💡 Зазвичай Partner Token = Application ID з розділу "Загальна інформація". Наприклад, якщо Application ID = 1193, то Partner Token = "1193".
                      </p>
                      <p style={{ margin: '8px 0 0 0', fontSize: '0.85em' }}>
                        Після додавання змінної середовища перезапустіть деплой або зачекайте 1-2 хвилини.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Банк ↔ Altegio" emoji="🏦">
          <div style={{ marginBottom: 16 }}>
            <p style={{ marginBottom: 12 }}>
              Тест матчингу банківських рахунків до рахунків Altegio. Показує збережений зв&apos;язок, токени назви, знайдений рахунок і причину, якщо баланс не підтягнувся.
            </p>
            <button
              onClick={testBankAccountsMatch}
              disabled={bankAccountsTestStatus.loading}
              style={{
                padding: '10px 20px',
                background: '#2a6df5',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                cursor: bankAccountsTestStatus.loading ? 'not-allowed' : 'pointer',
                opacity: bankAccountsTestStatus.loading ? 0.6 : 1,
              }}
            >
              {bankAccountsTestStatus.loading ? 'Перевірка...' : 'Тестувати рахунки'}
            </button>
          </div>

          {bankAccountsTestStatus.ok !== null && (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: bankAccountsTestStatus.ok ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${bankAccountsTestStatus.ok ? '#86efac' : '#fca5a5'}`,
                color: bankAccountsTestStatus.ok ? '#166534' : '#991b1b',
              }}
            >
              <strong>{bankAccountsTestStatus.ok ? '✅ Успішно' : '❌ Помилка'}:</strong>{' '}
              {bankAccountsTestStatus.ok
                ? 'Отримано діагностику матчингу рахунків.'
                : bankAccountsTestStatus.error || 'Невідома помилка'}

              {bankAccountsTestStatus.summary && (
                <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
                  <div>Рахунків Altegio: <strong>{bankAccountsTestStatus.summary.altegioAccountsCount}</strong></div>
                  <div>Банківських рахунків: <strong>{bankAccountsTestStatus.summary.bankAccountsCount}</strong></div>
                  <div>Є match: <strong>{bankAccountsTestStatus.summary.matchedCount}</strong></div>
                  <div>Match без балансу: <strong>{bankAccountsTestStatus.summary.missingBalanceCount}</strong></div>
                  <div>Помилок матчингу: <strong>{bankAccountsTestStatus.summary.errorsCount}</strong></div>
                </div>
              )}

              {bankAccountsTestStatus.ok && bankAccountsTestStatus.bankAccounts && bankAccountsTestStatus.bankAccounts.length > 0 && (
                <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
                  {bankAccountsTestStatus.bankAccounts.map((item) => (
                    <div
                      key={item.bankAccountId}
                      style={{
                        background: '#fff',
                        border: '1px solid #dbe4f0',
                        borderRadius: 8,
                        padding: 12,
                        color: '#1f2937',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>
                            {item.clientName || item.connectionName} ({item.accountLast4})
                          </div>
                          <div style={{ fontSize: '0.9em', color: '#6b7280' }}>
                            {item.connectionName} · {item.type || '—'} · {item.currencyCode}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', fontSize: '0.9em' }}>
                          <div>Source: <strong>{item.diagnostics.matchSource}</strong></div>
                          <div>Bank ID: <code>{item.bankAccountId}</code></div>
                          <button
                            onClick={() => syncBankAccount(item.bankAccountId)}
                            disabled={Boolean(bankSyncLoadingById[item.bankAccountId])}
                            style={{
                              marginTop: 8,
                              padding: '8px 12px',
                              background: '#2563eb',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 6,
                              fontWeight: 600,
                              cursor: bankSyncLoadingById[item.bankAccountId] ? 'not-allowed' : 'pointer',
                              opacity: bankSyncLoadingById[item.bankAccountId] ? 0.6 : 1,
                            }}
                          >
                            {bankSyncLoadingById[item.bankAccountId] ? 'Синхронізація...' : 'Пересинхронізувати'}
                          </button>
                        </div>
                      </div>

                      <div style={{ marginTop: 12, display: 'grid', gap: 6, fontSize: '0.92em' }}>
                        <div>Збережений Altegio ID: <code>{item.savedMatch.altegioAccountId || '—'}</code></div>
                        <div>Збережена назва: <strong>{item.savedMatch.altegioAccountTitle || '—'}</strong></div>
                        <div>Токени: <code>{item.diagnostics.inputTokens.length ? item.diagnostics.inputTokens.join(', ') : '—'}</code></div>
                        <div>Збіглись токени: <code>{item.diagnostics.matchedTokens.length ? item.diagnostics.matchedTokens.join(', ') : '—'}</code></div>
                        <div>
                          Знайдений рахунок: <strong>{item.diagnostics.matchedAccount?.title || '—'}</strong>
                          {item.diagnostics.matchedAccount ? ` (${item.diagnostics.matchedAccount.id})` : ''}
                        </div>
                        <div>
                          Баланс Altegio: <strong>{item.diagnostics.matchedAccount
                            ? item.diagnostics.matchedAccount.hasBalance
                              ? item.diagnostics.matchedAccount.balance || 'є'
                              : 'немає'
                            : '—'}</strong>
                        </div>
                        {item.diagnostics.matchedAccount?.balanceSource && item.diagnostics.matchedAccount.hasBalance && (
                          <div>
                            Джерело балансу: <strong>{item.diagnostics.matchedAccount.balanceSource === 'api' ? 'accounts API' : 'transactions fallback'}</strong>
                          </div>
                        )}
                        {item.diagnostics.error && (
                          <div style={{ color: '#b45309', fontWeight: 600 }}>
                            Помилка: {item.diagnostics.error}
                          </div>
                        )}
                        {item.savedMatch.altegioSyncError && (
                          <div style={{ color: '#b45309' }}>
                            Остання помилка синку: {item.savedMatch.altegioSyncError}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Пошук клієнта за Instagram" emoji="🔍">
          <div style={{ marginBottom: 16 }}>
            <p style={{ marginBottom: 12 }}>
              Введіть Instagram username для пошуку клієнта. Система шукає в полі email (формат: instagram_username@gmail.com).
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={instagramSearchValue}
                onChange={(e) => setInstagramSearchValue(e.target.value)}
                placeholder="Наприклад: mv_valeria або @mv_valeria"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && instagramSearchValue.trim()) {
                    searchClientByInstagram();
                  }
                }}
                style={{
                  flex: '1 1 300px',
                  padding: '10px 16px',
                  border: '1px solid #e0e7ef',
                  borderRadius: 8,
                  fontSize: '1em',
                  minWidth: '200px',
                }}
              />
              <button
                onClick={searchClientByInstagram}
                disabled={instagramSearchResult.loading || !instagramSearchValue.trim()}
                style={{
                  padding: '10px 24px',
                  background: instagramSearchResult.loading || !instagramSearchValue.trim() ? '#9ca3af' : '#2a6df5',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: instagramSearchResult.loading || !instagramSearchValue.trim() ? 'not-allowed' : 'pointer',
                  opacity: instagramSearchResult.loading || !instagramSearchValue.trim() ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {instagramSearchResult.loading ? 'Пошук...' : 'Знайти'}
              </button>
            </div>
          </div>

          {instagramSearchResult.ok !== null && (
            <div
              style={{
                padding: 16,
                borderRadius: 8,
                background: instagramSearchResult.ok ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${instagramSearchResult.ok ? '#86efac' : '#fca5a5'}`,
                color: instagramSearchResult.ok ? '#166534' : '#991b1b',
              }}
            >
              {instagramSearchResult.ok && instagramSearchResult.client ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <span style={{ fontSize: '1.5em' }}>✅</span>
                    <strong style={{ fontSize: '1.1em' }}>Клієнт знайдено!</strong>
                  </div>
                  <div style={{ background: '#fff', padding: 16, borderRadius: 8, border: '1px solid #d1d5db' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
                      <div>
                        <strong style={{ display: 'block', marginBottom: 4, color: '#6b7280', fontSize: '0.9em' }}>Ім'я та прізвище:</strong>
                        <div style={{ fontSize: '1.1em', fontWeight: 600, color: '#1f2937' }}>
                          {instagramSearchResult.client.name || '—'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ display: 'block', marginBottom: 4, color: '#6b7280', fontSize: '0.9em' }}>Номер телефону:</strong>
                        <div style={{ fontSize: '1.1em', fontFamily: 'monospace', color: '#1f2937' }}>
                          {instagramSearchResult.client.phone || '—'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ display: 'block', marginBottom: 4, color: '#6b7280', fontSize: '0.9em' }}>Email:</strong>
                        <div style={{ fontSize: '1em', color: '#1f2937', wordBreak: 'break-all' }}>
                          {instagramSearchResult.client.email || '—'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ display: 'block', marginBottom: 4, color: '#6b7280', fontSize: '0.9em' }}>Instagram:</strong>
                        <div style={{ fontSize: '1em', fontFamily: 'monospace', color: '#22c55e', fontWeight: 600 }}>
                          @{instagramSearchResult.client.instagramUsername || '—'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ display: 'block', marginBottom: 4, color: '#6b7280', fontSize: '0.9em' }}>ID клієнта:</strong>
                        <div style={{ fontSize: '1em', fontFamily: 'monospace', color: '#6b7280' }}>
                          {instagramSearchResult.client.id}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <strong style={{ display: 'block', marginBottom: 8 }}>❌ Клієнт не знайдено</strong>
                  <div style={{ fontSize: '0.9em', opacity: 0.9, marginBottom: 12 }}>
                    {instagramSearchResult.error || 'Клієнт з таким Instagram username не знайдено в системі.'}
                  </div>
                  {instagramSearchResult.diagnostics && (
                    <div style={{ 
                      padding: 12, 
                      background: '#f0f9ff', 
                      borderRadius: 6, 
                      border: '1px solid #bae6fd',
                      fontSize: '0.85em',
                      marginTop: 12
                    }}>
                      <strong style={{ display: 'block', marginBottom: 4 }}>📊 Діагностика:</strong>
                      <ul style={{ margin: '4px 0 0 0', paddingLeft: 20 }}>
                        <li>Перевірено клієнтів: <strong>{instagramSearchResult.diagnostics.searchedClients}</strong></li>
                        <li>Клієнтів з email: <strong>{instagramSearchResult.diagnostics.clientsWithEmail}</strong></li>
                        <li>Клієнтів без email: <strong>{instagramSearchResult.diagnostics.clientsWithoutEmail}</strong></li>
                      </ul>
                    </div>
                  )}
                  {instagramSearchResult.similarMatches && instagramSearchResult.similarMatches.length > 0 && (
                    <div style={{ 
                      padding: 12, 
                      background: '#fff3cd', 
                      borderRadius: 6, 
                      border: '1px solid #ffc107',
                      fontSize: '0.85em',
                      marginTop: 12
                    }}>
                      <strong style={{ display: 'block', marginBottom: 4 }}>🔍 Схожі збіги:</strong>
                      <ul style={{ margin: '4px 0 0 0', paddingLeft: 20 }}>
                        {instagramSearchResult.similarMatches.map((match: any, idx: number) => (
                          <li key={idx}>
                            {match.name || 'Без імені'} - {match.email} (Instagram: @{match.instagramPart})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {instagramSearchResult.sampleEmails && instagramSearchResult.sampleEmails.length > 0 && (
                    <details style={{ marginTop: 12 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9em' }}>
                        📋 Приклади email в системі (перші 10)
                      </summary>
                      <div style={{ 
                        marginTop: 8, 
                        padding: 12, 
                        background: '#f8fafc', 
                        borderRadius: 6,
                        fontSize: '0.85em'
                      }}>
                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                          {instagramSearchResult.sampleEmails.map((sample: any, idx: number) => (
                            <li key={idx} style={{ marginBottom: 4 }}>
                              {sample.name || 'Без імені'} - <code>{sample.email}</code> (Instagram: <code>@{sample.instagramPart}</code>)
                            </li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Тестування клієнтів" emoji="👥">
          <div style={{ marginBottom: 16 }}>
            <p style={{ marginBottom: 12 }}>
              Перевірка отримання клієнтів та кастомного поля "Instagram user name" через API.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={testClients}
                disabled={clientsTestStatus.loading}
                style={{
                  padding: '10px 20px',
                  background: '#2a6df5',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: clientsTestStatus.loading ? 'not-allowed' : 'pointer',
                  opacity: clientsTestStatus.loading ? 0.6 : 1,
                }}
              >
                {clientsTestStatus.loading ? 'Перевірка...' : 'Отримати клієнтів'}
              </button>
              <button
                onClick={testClientsDebug}
                disabled={clientsDebugLoading}
                style={{
                  padding: '10px 20px',
                  background: '#f59e0b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: clientsDebugLoading ? 'not-allowed' : 'pointer',
                  opacity: clientsDebugLoading ? 0.6 : 1,
                }}
              >
                {clientsDebugLoading ? 'Тестування...' : '🔧 Діагностика API'}
              </button>
              <button
                onClick={getDiagnostics}
                style={{
                  padding: '10px 20px',
                  background: '#6b7280',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🔍 Діагностика для підтримки
              </button>
            </div>
          </div>

          {diagnostics && (
            <div style={{ marginTop: 16, padding: 12, background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong>📋 Діагностична інформація для техпідтримки Altegio:</strong>
                <button
                  onClick={copyDiagnostics}
                  style={{
                    padding: '6px 12px',
                    background: diagnosticsCopied ? '#22c55e' : '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: '0.85em',
                  }}
                >
                  {diagnosticsCopied ? '✓ Скопійовано' : 'Скопіювати JSON'}
                </button>
              </div>
              <div style={{ padding: 12, background: '#fff', borderRadius: 6, fontSize: '0.85em', maxHeight: '400px', overflowY: 'auto' }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(diagnostics, null, 2)}
                </pre>
              </div>
              <p style={{ marginTop: 12, fontSize: '0.9em', color: '#6b7280' }}>
                Скопіюйте цю інформацію та надішліть її в техпідтримку Altegio для діагностики проблеми з правами доступу.
              </p>
            </div>
          )}

          {clientsTestStatus.ok !== null && (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: clientsTestStatus.ok ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${clientsTestStatus.ok ? '#86efac' : '#fca5a5'}`,
                color: clientsTestStatus.ok ? '#166534' : '#991b1b',
              }}
            >
              <strong>{clientsTestStatus.ok ? '✅ Успішно' : '❌ Помилка'}:</strong>{' '}
              {clientsTestStatus.message}
              {clientsTestStatus.clientsCount !== undefined && (
                <div style={{ marginTop: 8 }}>
                  Знайдено клієнтів: <strong>{clientsTestStatus.clientsCount}</strong>
                </div>
              )}

              {clientsTestStatus.ok && clientsTestStatus.clients && clientsTestStatus.clients.length > 0 && (
                <div style={{ marginTop: 16, padding: 12, background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd' }}>
                  <strong style={{ display: 'block', marginBottom: 12 }}>👥 Список клієнтів:</strong>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #bae6fd', textAlign: 'left' }}>
                          <th style={{ padding: '8px', fontWeight: 600 }}>ID</th>
                          <th style={{ padding: '8px', fontWeight: 600 }}>Ім'я</th>
                          <th style={{ padding: '8px', fontWeight: 600 }}>Телефон</th>
                          <th style={{ padding: '8px', fontWeight: 600 }}>Email</th>
                          <th style={{ padding: '8px', fontWeight: 600 }}>Instagram</th>
                          <th style={{ padding: '8px', fontWeight: 600 }}>Card Number</th>
                          <th style={{ padding: '8px', fontWeight: 600 }}>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientsTestStatus.clients.map((client: any, index: number) => (
                          <tr 
                            key={client.id || index}
                            style={{ 
                              borderBottom: '1px solid #e0e7ef',
                              backgroundColor: index % 2 === 0 ? '#fff' : '#fafafa'
                            }}
                          >
                            <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '0.85em' }}>
                              {client.id || 'N/A'}
                            </td>
                            <td style={{ padding: '8px', fontWeight: 500 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span>{client.name || '—'}</span>
                                {client.id && (
                                  <button
                                    onClick={() => getClientDetails(client.id)}
                                    disabled={selectedClientLoading}
                                    style={{
                                      padding: '4px 8px',
                                      background: '#f59e0b',
                                      color: '#fff',
                                      border: 'none',
                                      borderRadius: 4,
                                      fontSize: '0.75em',
                                      cursor: selectedClientLoading ? 'not-allowed' : 'pointer',
                                      opacity: selectedClientLoading ? 0.6 : 1,
                                    }}
                                    title="Отримати повну структуру клієнта"
                                  >
                                    {selectedClientLoading && selectedClientDetails?.clientId === client.id ? '...' : '🔍'}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '0.85em' }}>
                              {client.phone || '—'}
                            </td>
                            <td style={{ padding: '8px', fontSize: '0.85em' }}>
                              {client.email || '—'}
                            </td>
                            <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '0.85em' }}>
                              {client.instagram && client.instagram !== '—' ? (
                                <span style={{ color: '#22c55e', fontWeight: 600 }}>@{client.instagram}</span>
                              ) : (
                                <span style={{ color: '#ef4444' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '0.85em', color: client.cardNumber && client.cardNumber !== '—' ? '#166534' : '#6b7280' }}>
                              {client.cardNumber || '—'}
                            </td>
                            <td style={{ padding: '8px', fontSize: '0.85em', color: client.note && client.note !== '—' ? '#166534' : '#6b7280', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {client.note || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {clientsTestStatus.ok && clientsTestStatus.firstClientStructure && (
                <div style={{ marginTop: 16, padding: 12, background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd' }}>
                  <strong style={{ display: 'block', marginBottom: 12 }}>📋 Структура першого клієнта:</strong>
                  
                  {clientsTestStatus.instagramFieldFound ? (
                    <div style={{ padding: 12, background: '#dcfce7', borderRadius: 6, border: '1px solid #86efac', marginBottom: 12 }}>
                      <strong style={{ color: '#166534' }}>✅ Instagram поле знайдено!</strong>
                      <div style={{ marginTop: 8, fontSize: '0.9em' }}>
                        <strong>Назва поля:</strong> <code>{clientsTestStatus.instagramFieldName}</code>
                        <br />
                        <strong>Значення:</strong> <code>{clientsTestStatus.instagramFieldValue}</code>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: 12, background: '#fef3c7', borderRadius: 6, border: '1px solid #fcd34d', marginBottom: 12 }}>
                      <strong style={{ color: '#92400e' }}>⚠️ Instagram поле не знайдено</strong>
                      <p style={{ margin: '8px 0 0 0', fontSize: '0.9em' }}>
                        Перевірте всі можливі варіанти назв поля в структурі нижче.
                      </p>
                    </div>
                  )}

                  <div style={{ marginTop: 12 }}>
                    <strong>Основні поля:</strong>
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: 20, fontSize: '0.9em' }}>
                      <li>ID: <code>{clientsTestStatus.firstClientStructure.id}</code></li>
                      <li>Ім'я: <code>{clientsTestStatus.firstClientStructure.name}</code></li>
                      {clientsTestStatus.firstClientStructure.phone && (
                        <li>Телефон: <code>{clientsTestStatus.firstClientStructure.phone}</code></li>
                      )}
                      {clientsTestStatus.firstClientStructure.email && (
                        <li>Email: <code>{clientsTestStatus.firstClientStructure.email}</code></li>
                      )}
                    </ul>
                  </div>

                  {clientsTestStatus.customFields && clientsTestStatus.customFields.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <strong>Всі поля клієнта ({clientsTestStatus.allKeys?.length || 0}):</strong>
                      <div style={{ marginTop: 8, padding: 8, background: '#fff', borderRadius: 4, fontSize: '0.85em', maxHeight: '200px', overflowY: 'auto' }}>
                        <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {JSON.stringify(clientsTestStatus.firstClientStructure.customFieldsData, null, 2)}
                        </code>
                      </div>
                    </div>
                  )}

                  {clientsTestStatus.firstClientStructure.custom_fields && (
                    <div style={{ marginTop: 12 }}>
                      <strong>Custom fields об'єкт:</strong>
                      <div style={{ marginTop: 8, padding: 8, background: '#fff', borderRadius: 4, fontSize: '0.85em', maxHeight: '150px', overflowY: 'auto' }}>
                        <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {JSON.stringify(clientsTestStatus.firstClientStructure.custom_fields, null, 2)}
                        </code>
                      </div>
                    </div>
                  )}

                  {clientsTestStatus.firstClientStructure.rawStructure && (
                    <div style={{ marginTop: 12 }}>
                      <details>
                        <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 8 }}>
                          🔍 Повна raw структура першого клієнта (для діагностики)
                        </summary>
                        <div style={{ marginTop: 8, padding: 8, background: '#fff', borderRadius: 4, fontSize: '0.8em', maxHeight: '400px', overflowY: 'auto', border: '1px solid #e0e7ef' }}>
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {clientsTestStatus.firstClientStructure.rawStructure}
                          </pre>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              )}

                  {clientsTestStatus.error && (
                <div style={{ marginTop: 8, fontSize: '0.9em', opacity: 0.9 }}>
                  {clientsTestStatus.error}
                  {(clientsTestStatus.error.includes('No company management rights') || clientsTestStatus.error.includes('403')) && (
                    <div style={{ marginTop: 12, padding: 12, background: '#fff3cd', borderRadius: 6, border: '1px solid #ffc107', color: '#856404' }}>
                      <strong>💡 Важливо! Після надання прав потрібно згенерувати новий USER_TOKEN:</strong>
                      <ol style={{ margin: '8px 0 0 0', paddingLeft: 22 }}>
                        <li>Перейдіть в кабінет Altegio → Маркетплейс → Ваш додаток</li>
                        <li>Відкрийте розділ "Доступ до API" (API Access)</li>
                        <li>Переконайтеся, що права надані:
                          <ul style={{ marginTop: 4, paddingLeft: 18 }}>
                            <li>✅ "Клієнтська база" (Client base) - всі права</li>
                            <li>✅ "Журнал запису" (Record log) - всі права</li>
                          </ul>
                        </li>
                        <li><strong>ВАЖЛИВО:</strong> Після надання прав <strong>необхідно згенерувати новий USER_TOKEN</strong>:
                          <ul style={{ marginTop: 4, paddingLeft: 18 }}>
                            <li>Скопіюйте новий токен з поля "User Token"</li>
                            <li>Оновіть змінну середовища <code>ALTEGIO_USER_TOKEN</code> в Vercel</li>
                            <li>Старий токен може не мати нових прав, навіть якщо права надані!</li>
                          </ul>
                        </li>
                        <li>Після оновлення токена зачекайте 1-2 хвилини або перезапустіть деплой</li>
                      </ol>
                      <p style={{ margin: '12px 0 0 0', padding: 8, background: '#ffe69c', borderRadius: 4, fontSize: '0.9em' }}>
                        ⚠️ <strong>Поточна помилка:</strong> Навіть якщо права надані, старий USER_TOKEN не має цих прав. Потрібно згенерувати новий токен!
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {selectedClientDetails && (
            <div style={{ marginTop: 24, padding: 16, background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '1.2em' }}>🔍</span> Повна структура клієнта {selectedClientDetails.clientId}
                </h3>
                <button
                  onClick={() => setSelectedClientDetails(null)}
                  style={{
                    padding: '6px 12px',
                    background: '#6b7280',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: '0.85em',
                  }}
                >
                  ✕ Закрити
                </button>
              </div>

              {selectedClientDetails.ok && selectedClientDetails.rawStructure && (
                <div>
                  <div style={{ marginBottom: 12, padding: 12, background: '#fff', borderRadius: 6, border: '1px solid #e0e7ef' }}>
                    <strong style={{ display: 'block', marginBottom: 8 }}>📋 Повна raw структура:</strong>
                    <pre style={{ 
                      margin: 0, 
                      padding: 12, 
                      background: '#f8fafc', 
                      borderRadius: 4, 
                      fontSize: '0.85em', 
                      maxHeight: '500px', 
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all'
                    }}>
                      {selectedClientDetails.rawStructure}
                    </pre>
                  </div>

                  {selectedClientDetails.customFieldsData && (
                    <div style={{ marginBottom: 12, padding: 12, background: '#dcfce7', borderRadius: 6, border: '1px solid #86efac' }}>
                      <strong style={{ display: 'block', marginBottom: 8, color: '#166534' }}>✅ Custom Fields:</strong>
                      <pre style={{ 
                        margin: 0, 
                        padding: 12, 
                        background: '#fff', 
                        borderRadius: 4, 
                        fontSize: '0.85em', 
                        maxHeight: '300px', 
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                      }}>
                        {JSON.stringify(selectedClientDetails.customFieldsData, null, 2)}
                      </pre>
                    </div>
                  )}

                  {selectedClientDetails.client?._meta && (
                    <div style={{ marginTop: 12, padding: 12, background: '#fff', borderRadius: 6, border: '1px solid #e0e7ef' }}>
                      <strong style={{ display: 'block', marginBottom: 8 }}>📊 Мета-інформація:</strong>
                      <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.9em' }}>
                        <li>Всього полів: {selectedClientDetails.client._meta.allKeys?.length || 0}</li>
                        <li>Кастомні поля: {selectedClientDetails.client._meta.customFields?.length || 0}</li>
                        <li>Має custom_fields: {selectedClientDetails.client._meta.hasCustomFields ? '✅ Так' : '❌ Ні'}</li>
                        {selectedClientDetails.client._meta.customFieldsKeys && selectedClientDetails.client._meta.customFieldsKeys.length > 0 && (
                          <li>Ключі custom_fields: {selectedClientDetails.client._meta.customFieldsKeys.join(', ')}</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {!selectedClientDetails.ok && selectedClientDetails.error && (
                <div style={{ padding: 12, background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5', color: '#991b1b' }}>
                  <strong>❌ Помилка:</strong> {selectedClientDetails.error}
                </div>
              )}
            </div>
          )}
        </Card>

        {clientsDebug && (
          <Card title="🔧 Діагностика API клієнтів" emoji="🔧">
            <div style={{ padding: 16 }}>
              {clientsDebug.ok && clientsDebug.results && (
                <div>
                  <div style={{ marginBottom: 16, padding: 12, background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd' }}>
                    <strong>📊 Підсумок тестування:</strong>
                    <ul style={{ margin: '8px 0 0 0', paddingLeft: 22 }}>
                      <li>Всього тестів: <strong>{clientsDebug.summary?.totalTests || 0}</strong></li>
                      <li>Успішних: <strong style={{ color: '#16a34a' }}>{clientsDebug.summary?.successful || 0}</strong></li>
                      <li>Помилок: <strong style={{ color: '#dc2626' }}>{clientsDebug.summary?.failed || 0}</strong></li>
                      <li>Винятків: <strong style={{ color: '#dc2626' }}>{clientsDebug.summary?.errors || 0}</strong></li>
                    </ul>
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <strong>Детальні результати:</strong>
                    <div style={{ marginTop: 12 }}>
                      {clientsDebug.results.map((result: any, index: number) => (
                        <div
                          key={index}
                          style={{
                            marginBottom: 12,
                            padding: 12,
                            background: result.success ? '#f0fdf4' : result.error ? '#fef2f2' : '#fef3c7',
                            borderRadius: 6,
                            border: `1px solid ${result.success ? '#86efac' : result.error ? '#fca5a5' : '#fcd34d'}`,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <strong style={{ color: result.success ? '#166534' : result.error ? '#991b1b' : '#92400e' }}>
                              {result.success ? '✅' : result.error ? '❌' : '⚠️'} {result.test}
                            </strong>
                            {result.status && (
                              <span style={{ fontSize: '0.9em', color: result.success ? '#16a34a' : '#dc2626' }}>
                                {result.status} {result.statusText}
                              </span>
                            )}
                          </div>
                          
                          {result.url && (
                            <div style={{ marginTop: 8, fontSize: '0.85em', color: '#6b7280' }}>
                              <strong>URL:</strong> <code style={{ wordBreak: 'break-all' }}>{result.url}</code>
                            </div>
                          )}
                          
                          {result.method && (
                            <div style={{ marginTop: 4, fontSize: '0.85em', color: '#6b7280' }}>
                              <strong>Method:</strong> <code>{result.method}</code>
                            </div>
                          )}

                          {result.response && (
                            <details style={{ marginTop: 8, cursor: 'pointer' }}>
                              <summary style={{ fontWeight: 600, fontSize: '0.9em' }}>Відповідь API</summary>
                              <div style={{ marginTop: 8, padding: 8, background: '#fff', borderRadius: 4, fontSize: '0.85em', maxHeight: '300px', overflowY: 'auto' }}>
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                  {JSON.stringify(result.response, null, 2)}
                                </pre>
                              </div>
                            </details>
                          )}

                          {result.error && (
                            <div style={{ marginTop: 8, padding: 8, background: '#fee2e2', borderRadius: 4, color: '#991b1b', fontSize: '0.85em' }}>
                              <strong>Помилка:</strong> {result.error}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {!clientsDebug.ok && clientsDebug.error && (
                <div style={{ padding: 12, background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5', color: '#991b1b' }}>
                  <strong>❌ Помилка:</strong> {clientsDebug.error}
                </div>
              )}
            </div>
          </Card>
        )}

        <Card title="Календар записів" emoji="📅">
          <div style={{ marginBottom: 16 }}>
            <p style={{ marginBottom: 12 }}>
              Отримання майбутніх записів з календаря (на наступні 30 днів). Перевірка наявності Instagram username у клієнтів.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={testAppointments}
                disabled={appointmentsTestStatus.loading}
                style={{
                  padding: '10px 20px',
                  background: '#2a6df5',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: appointmentsTestStatus.loading ? 'not-allowed' : 'pointer',
                  opacity: appointmentsTestStatus.loading ? 0.6 : 1,
                }}
              >
                {appointmentsTestStatus.loading ? 'Завантаження...' : 'Отримати майбутні записи'}
              </button>
              <button
                onClick={testFullWeekAppointments}
                disabled={fullWeekAppointmentsStatus.loading}
                style={{
                  padding: '10px 20px',
                  background: '#f59e0b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: fullWeekAppointmentsStatus.loading ? 'not-allowed' : 'pointer',
                  opacity: fullWeekAppointmentsStatus.loading ? 0.6 : 1,
                }}
              >
                {fullWeekAppointmentsStatus.loading ? 'Завантаження...' : '📊 Отримати записи за тиждень (всі поля)'}
              </button>
            </div>
          </div>

          {appointmentsTestStatus.ok !== null && (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: appointmentsTestStatus.ok ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${appointmentsTestStatus.ok ? '#86efac' : '#fca5a5'}`,
                color: appointmentsTestStatus.ok ? '#166534' : '#991b1b',
              }}
            >
              <strong>{appointmentsTestStatus.ok ? '✅ Успішно' : '❌ Помилка'}:</strong>{' '}
              {appointmentsTestStatus.message}
              
              {appointmentsTestStatus.ok && appointmentsTestStatus.appointmentsCount !== undefined && (
                <div style={{ marginTop: 12, padding: 12, background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd', color: '#0c4a6e' }}>
                  <div style={{ marginBottom: 8 }}>
                    <strong>📊 Статистика:</strong>
                  </div>
                  <ul style={{ margin: '8px 0', paddingLeft: 22 }}>
                    <li>Всього майбутніх записів: <strong>{appointmentsTestStatus.appointmentsCount}</strong></li>
                    <li>Записів з Instagram username: <strong>{appointmentsTestStatus.appointmentsWithInstagram || 0}</strong></li>
                    <li>Період: <strong>наступні {appointmentsTestStatus.days || 30} днів</strong></li>
                  </ul>
                </div>
              )}

              {appointmentsTestStatus.ok && appointmentsTestStatus.appointments && appointmentsTestStatus.appointments.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <strong style={{ display: 'block', marginBottom: 12 }}>📋 Список записів ({appointmentsTestStatus.appointments.slice(0, 10).length} з {appointmentsTestStatus.appointments.length}):</strong>
                  <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, padding: 8 }}>
                    {appointmentsTestStatus.appointments.slice(0, 10).map((apt, idx) => (
                      <div
                        key={apt.id || idx}
                        style={{
                          padding: 10,
                          marginBottom: 8,
                          background: '#fff',
                          borderRadius: 6,
                          border: '1px solid #e5e7eb',
                          fontSize: '0.9em',
                        }}
                      >
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                          {apt.client_name || 'Без імені'}
                          {apt.instagram_username && (
                            <span style={{ marginLeft: 8, color: '#22c55e', fontSize: '0.85em' }}>
                              📱 @{apt.instagram_username}
                            </span>
                          )}
                        </div>
                        <div style={{ color: '#6b7280', fontSize: '0.85em' }}>
                          {apt.datetime ? new Date(apt.datetime).toLocaleString('uk-UA', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          }) : 'Дата не вказана'}
                          {apt.status && (
                            <span style={{ marginLeft: 8 }}>• Статус: {apt.status}</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {appointmentsTestStatus.appointments.length > 10 && (
                      <div style={{ textAlign: 'center', padding: 8, color: '#6b7280', fontSize: '0.85em' }}>
                        ... та ще {appointmentsTestStatus.appointments.length - 10} записів
                      </div>
                    )}
                  </div>
                </div>
              )}

              {appointmentsTestStatus.error && (
                <div style={{ marginTop: 8, fontSize: '0.9em', opacity: 0.9 }}>
                  {appointmentsTestStatus.error}
                  {appointmentsTestStatus.error.includes('No company management rights') && (
                    <div style={{ marginTop: 12, padding: 12, background: '#fff3cd', borderRadius: 6, border: '1px solid #ffc107', color: '#856404' }}>
                      <strong>💡 Як вирішити помилку "No company management rights":</strong>
                      <ol style={{ margin: '8px 0 0 0', paddingLeft: 22 }}>
                        <li>Перейдіть в кабінет Altegio → Маркетплейс → Ваш додаток</li>
                        <li>Відкрийте розділ "Доступ до API" (API Access)</li>
                        <li>Переконайтеся, що у вашому USER_TOKEN включені права:
                          <ul style={{ marginTop: 4, paddingLeft: 18 }}>
                            <li>✅ Читання клієнтів (Read clients)</li>
                            <li>✅ Читання записів (Read appointments)</li>
                            <li>✅ Управління компанією (Company management)</li>
                          </ul>
                        </li>
                        <li>Якщо права не налаштовані, оновіть токен або створіть новий з необхідними правами</li>
                        <li>Після оновлення прав оновіть ALTEGIO_USER_TOKEN в Vercel environment variables</li>
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
                    {fullWeekAppointmentsStatus.ok !== null && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 8,
                background: fullWeekAppointmentsStatus.ok ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${fullWeekAppointmentsStatus.ok ? '#86efac' : '#fca5a5'}`,
                color: fullWeekAppointmentsStatus.ok ? '#166534' : '#991b1b',
              }}
            >
              <strong>
                {fullWeekAppointmentsStatus.ok
                  ? '✅ Успішно (записи за тиждень)'
                  : '❌ Помилка (записи за тиждень)'}
                :
              </strong>{' '}
              {fullWeekAppointmentsStatus.data?.message || fullWeekAppointmentsStatus.error}

              {fullWeekAppointmentsStatus.ok && fullWeekAppointmentsStatus.data && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    background: '#f0f9ff',
                    borderRadius: 6,
                    border: '1px solid #bae6fd',
                    color: '#0c4a6e',
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    <strong>📊 Статистика за тиждень:</strong>
                  </div>
                  <ul style={{ margin: '8px 0', paddingLeft: 22, fontSize: '0.9em' }}>
                    <li>
                      Всього записів (appointments + visits):{' '}
                      <strong>
                        {fullWeekAppointmentsStatus.data.summary?.total ??
                          fullWeekAppointmentsStatus.data.totalAppointments ??
                          '—'}
                      </strong>
                    </li>
                    <li>
                      Минулі записи:{' '}
                      <strong>
                        {fullWeekAppointmentsStatus.data.summary?.past ??
                          fullWeekAppointmentsStatus.data.pastAppointmentsCount ??
                          '—'}
                      </strong>
                    </li>
                    <li>
                      Майбутні записи:{' '}
                      <strong>
                        {fullWeekAppointmentsStatus.data.summary?.future ??
                          fullWeekAppointmentsStatus.data.upcomingAppointmentsCount ??
                          '—'}
                      </strong>
                    </li>
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Шаблони повідомлень" emoji="✏️">
          <div style={{ marginBottom: 16 }}>
            <p style={{ marginBottom: 12 }}>
              Налаштуйте шаблони повідомлень для нагадувань. Використовуйте плейсхолдери: {'{date}'}, {'{time}'}, {'{clientName}'}, {'{daysLeft}'}, {'{service}'}, {'{master}'}.
            </p>
            <button
              onClick={loadReminderRules}
              disabled={reminderRules.loading}
              style={{
                padding: '10px 20px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                cursor: reminderRules.loading ? 'not-allowed' : 'pointer',
                opacity: reminderRules.loading ? 0.6 : 1,
                marginBottom: 12,
              }}
            >
              {reminderRules.loading ? 'Завантаження...' : 'Завантажити шаблони'}
            </button>
          </div>

          {reminderRules.ok !== null && (
            <div>
              {reminderRules.ok && reminderRules.rules ? (
                <div>
                  {reminderRules.rules.map((rule, idx) => (
                    <div
                      key={rule.id}
                      style={{
                        marginBottom: 20,
                        padding: 16,
                        background: '#f8fafc',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <strong style={{ fontSize: '1.1em' }}>
                          За {rule.daysBefore} {rule.daysBefore === 1 ? 'день' : rule.daysBefore < 5 ? 'дні' : 'днів'} до візиту
                        </strong>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                          <input
                            type="checkbox"
                            checked={rule.active}
                            onChange={(e) => {
                              const newRules = [...reminderRules.rules!];
                              newRules[idx].active = e.target.checked;
                              setReminderRules({ ...reminderRules, rules: newRules });
                            }}
                            style={{ width: 18, height: 18 }}
                          />
                          <span style={{ fontSize: '0.9em' }}>Активне</span>
                        </label>
                      </div>
                      <textarea
                        value={rule.template}
                        onChange={(e) => {
                          const newRules = [...reminderRules.rules!];
                          newRules[idx].template = e.target.value;
                          setReminderRules({ ...reminderRules, rules: newRules });
                        }}
                        style={{
                          width: '100%',
                          minHeight: 80,
                          padding: 12,
                          border: '1px solid #cbd5e1',
                          borderRadius: 6,
                          fontSize: '0.95em',
                          fontFamily: 'inherit',
                          resize: 'vertical',
                        }}
                        placeholder="Введіть шаблон повідомлення..."
                      />
                      <div style={{ marginTop: 8, fontSize: '0.85em', color: '#64748b' }}>
                        Доступні плейсхолдери: {'{date}'}, {'{time}'}, {'{clientName}'}, {'{daysLeft}'}, {'{service}'}, {'{master}'}, {'{instagram}'}
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={saveReminderRules}
                    disabled={reminderRules.loading}
                    style={{
                      padding: '12px 24px',
                      background: '#22c55e',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      fontWeight: 600,
                      cursor: reminderRules.loading ? 'not-allowed' : 'pointer',
                      opacity: reminderRules.loading ? 0.6 : 1,
                      fontSize: '1em',
                    }}
                  >
                    {reminderRules.loading ? 'Збереження...' : '💾 Зберегти шаблони'}
                  </button>
                </div>
              ) : (
                <div>
                  <strong>❌ Помилка:</strong>{' '}
                  {reminderRules.error || 'Не вдалося завантажити шаблони'}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Черга нагадувань" emoji="📬">
          <div style={{ marginBottom: 16 }}>
            <p style={{ marginBottom: 12 }}>
              Клієнти, які очікують на відправку нагадувань про майбутні візити. Нагадування створюються автоматично при створенні/оновленні записів у Altegio.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => loadRemindersQueue('pending')}
                disabled={remindersQueue.loading}
                style={{
                  padding: '10px 20px',
                  background: '#2a6df5',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: remindersQueue.loading ? 'not-allowed' : 'pointer',
                  opacity: remindersQueue.loading ? 0.6 : 1,
                }}
              >
                {remindersQueue.loading ? 'Завантаження...' : 'Оновити чергу'}
              </button>
              <button
                onClick={() => loadRemindersQueue('all')}
                disabled={remindersQueue.loading}
                style={{
                  padding: '10px 20px',
                  background: '#6b7280',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: remindersQueue.loading ? 'not-allowed' : 'pointer',
                  opacity: remindersQueue.loading ? 0.6 : 1,
                }}
              >
                {remindersQueue.loading ? 'Завантаження...' : 'Всі job\'и'}
              </button>
              <button
                onClick={loadRemindersDebug}
                disabled={remindersDebug.loading}
                style={{
                  padding: '10px 20px',
                  background: '#f59e0b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: remindersDebug.loading ? 'not-allowed' : 'pointer',
                  opacity: remindersDebug.loading ? 0.6 : 1,
                }}
              >
                {remindersDebug.loading ? 'Завантаження...' : '🔍 Діагностика'}
              </button>
              <button
                onClick={async () => {
                  // Тестовий запис на 7 днів наперед
                  const testDatetime = new Date();
                  testDatetime.setDate(testDatetime.getDate() + 7);
                  testDatetime.setHours(15, 0, 0, 0);
                  
                  try {
                    const res = await fetch('/api/altegio/reminders/test-create', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        visitId: 999999999,
                        datetime: testDatetime.toISOString(),
                        instagram: 'mykolayyurashko',
                        clientName: 'Микола Юрашко (тест)',
                      }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      alert(`✅ Створено ${data.jobsCreated.length} job'ів! Тепер оновіть чергу.`);
                      loadRemindersQueue();
                    } else {
                      alert(`❌ Помилка: ${data.error}`);
                    }
                  } catch (err) {
                    alert(`❌ Помилка: ${err instanceof Error ? err.message : 'Невідома помилка'}`);
                  }
                }}
                style={{
                  padding: '10px 20px',
                  background: '#10b981',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🧪 Тест створення job'ів
              </button>
              <button
                onClick={async () => {
                  if (remindersQueue.jobs && remindersQueue.jobs.length > 0) {
                    const firstJob = remindersQueue.jobs[0];
                    const confirmSend = confirm(
                      `Відправити тестове повідомлення для:\n\n` +
                      `Клієнт: ${firstJob.clientName}\n` +
                      `Instagram: ${firstJob.instagram || '—'}\n` +
                      `Дата візиту: ${new Date(firstJob.visitDateTime).toLocaleString('uk-UA')}\n\n` +
                      `Продовжити?`
                    );
                    
                    if (!confirmSend) return;
                    
                    // Питаємо, чи є subscriber_id для тестування
                    const subscriberIdInput = prompt(
                      `Відправити тестове повідомлення для:\n\n` +
                      `Клієнт: ${firstJob.clientName}\n` +
                      `Instagram: ${firstJob.instagram || '—'}\n` +
                      `Дата візиту: ${new Date(firstJob.visitDateTime).toLocaleString('uk-UA')}\n\n` +
                      `Якщо знаєш Subscriber ID з ManyChat Dashboard, введи його (або залиш порожнім для автоматичного пошуку):`
                    );
                    
                    if (subscriberIdInput === null) return; // Користувач скасував
                    
                    try {
                      const res = await fetch('/api/altegio/reminders/test-send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          jobId: firstJob.id,
                          subscriberId: subscriberIdInput?.trim() || undefined,
                        }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        const methodInfo = data.method?.includes('симуляція') 
                          ? `⚠️ ${data.method}\n\n💡 Для реальної відправки:\n1. Додай MANYCHAT_API_KEY в Vercel\n2. Переконайся, що @${data.job.instagram} взаємодіяв з ManyChat ботом`
                          : `✅ ${data.method}`;
                        
                        alert(
                          `${data.method?.includes('симуляція') ? '⚠️' : '✅'} Повідомлення відправлено!\n\n` +
                          `Метод: ${methodInfo}\n` +
                          `Instagram: ${data.job.instagram}\n` +
                          `Message ID: ${data.result.messageId || '—'}\n\n` +
                          (data.diagnostics ? `Діагностика:\n- ManyChat API: ${data.diagnostics.manychatApiKeyConfigured ? '✅ Налаштовано' : '❌ Не налаштовано'}\n- Instagram API: ${data.diagnostics.instagramTokenConfigured ? '✅ Налаштовано' : '❌ Не налаштовано'}` : '')
                        );
                        loadSentReminders();
                      } else {
                        alert(`❌ Помилка відправки:\n${data.error || 'Невідома помилка'}`);
                      }
                    } catch (err) {
                      alert(`❌ Помилка: ${err instanceof Error ? err.message : 'Невідома помилка'}`);
                    }
                  } else {
                    // Якщо немає job'ів, відправляємо тестове повідомлення
                    const confirmSend = confirm(
                      `Відправити тестове повідомлення для тестового клієнта @mykolayyurashko?\n\n` +
                      `(Якщо ManyChat API не налаштовано, буде симуляція)`
                    );
                    
                    if (!confirmSend) return;
                    
                    try {
                      const res = await fetch('/api/altegio/reminders/test-send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          instagram: 'mykolayyurashko',
                        }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        const methodInfo = data.method?.includes('симуляція') 
                          ? `⚠️ ${data.method}\n\n💡 Для реальної відправки:\n1. Додай MANYCHAT_API_KEY в Vercel\n2. Переконайся, що @${data.job.instagram} взаємодіяв з ManyChat ботом`
                          : `✅ ${data.method}`;
                        
                        alert(
                          `${data.method?.includes('симуляція') ? '⚠️' : '✅'} Повідомлення відправлено!\n\n` +
                          `Метод: ${methodInfo}\n` +
                          `Instagram: ${data.job.instagram}\n` +
                          `Message ID: ${data.result.messageId || '—'}\n\n` +
                          (data.diagnostics ? `Діагностика:\n- ManyChat API: ${data.diagnostics.manychatApiKeyConfigured ? '✅ Налаштовано' : '❌ Не налаштовано'}\n- Instagram API: ${data.diagnostics.instagramTokenConfigured ? '✅ Налаштовано' : '❌ Не налаштовано'}` : '')
                        );
                        loadSentReminders();
                      } else {
                        alert(`❌ Помилка відправки:\n${data.error || 'Невідома помилка'}`);
                      }
                    } catch (err) {
                      alert(`❌ Помилка: ${err instanceof Error ? err.message : 'Невідома помилка'}`);
                    }
                  }
                }}
                style={{
                  padding: '10px 20px',
                  background: '#8b5cf6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                📤 Тест відправки
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch('/api/altegio/reminders/check-subscriber?instagram=mykolayyurashko', {
                      method: 'GET',
                    });
                    const data = await res.json();
                    if (data.ok) {
                      // Instagram username без @ (endpoint вже видаляє @)
                      const instagramDisplay = data.instagram.startsWith('@') ? data.instagram : `@${data.instagram}`;
                      
                      if (data.found) {
                        alert(
                          `✅ Subscriber знайдено в ManyChat!\n\n` +
                          `Instagram: ${instagramDisplay}\n` +
                          `Subscriber ID: ${data.subscriberId}\n\n` +
                          `Тепер можна відправляти повідомлення.`
                        );
                      } else {
                        alert(
                          `❌ Subscriber не знайдено в ManyChat\n\n` +
                          `Instagram: ${instagramDisplay}\n\n` +
                          `Що робити:\n` +
                          `1. Відкрий Instagram на акаунті ${instagramDisplay}\n` +
                          `2. Знайди ManyChat бот (або сторінку, яка використовує ManyChat)\n` +
                          `3. Напиши будь-яке повідомлення боту\n` +
                          `4. Або натисни на кнопку в автоматизації ManyChat\n` +
                          `5. Після цього спробуй перевірити знову`
                        );
                      }
                    } else {
                      alert(`❌ Помилка перевірки:\n${data.error || 'Невідома помилка'}\n\n${data.diagnostics ? `Перевірені змінні: ${data.diagnostics.checkedVariables?.join(', ')}` : ''}`);
                    }
                  } catch (err) {
                    alert(`❌ Помилка: ${err instanceof Error ? err.message : 'Невідома помилка'}`);
                  }
                }}
                style={{
                  padding: '10px 20px',
                  background: '#06b6d4',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🔍 Перевірити subscriber
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch('/api/altegio/reminders/test-manychat-api?instagram=mykolayyurashko', {
                      method: 'GET',
                    });
                    const data = await res.json();
                    if (data.ok) {
                      const successful = data.successfulResults || [];
                      const allResults = data.allResults || [];
                      
                      let message = `🔍 Діагностика ManyChat API\n\n`;
                      message += `Instagram: ${data.instagram}\n`;
                      message += `Знайдено: ${data.found ? '✅ Так' : '❌ Ні'}\n\n`;
                      message += `Успішні тести: ${successful.length}\n`;
                      message += `Всього тестів: ${allResults.length}\n\n`;
                      
                      if (successful.length > 0) {
                        message += `✅ Знайдено через:\n`;
                        successful.forEach((r: any) => {
                          message += `- ${r.method}: Subscriber ID ${r.subscriberId}\n`;
                        });
                      } else {
                        message += `❌ Не знайдено жодним методом:\n\n`;
                        allResults.forEach((r: any) => {
                          message += `${r.method}:\n`;
                          message += `  Status: ${r.status || 'N/A'}\n`;
                          if (r.error) {
                            message += `  Error: ${r.error}\n`;
                          } else if (r.response) {
                            const responseStr = typeof r.response === 'string' ? r.response : JSON.stringify(r.response).substring(0, 200);
                            message += `  Response: ${responseStr}\n`;
                          }
                          message += `\n`;
                        });
                        
                        if (data.recommendations && data.recommendations.length > 0) {
                          message += `\n💡 Рекомендації:\n`;
                          data.recommendations.forEach((rec: string) => {
                            message += `${rec}\n`;
                          });
                        }
                      }
                      
                      setDiagnosticsModal({
                        open: true,
                        title: '🔬 Діагностика ManyChat API',
                        content: message,
                        jsonData: data,
                      });
                    } else {
                      setDiagnosticsModal({
                        open: true,
                        title: '❌ Помилка',
                        content: `Помилка: ${data.error || 'Невідома помилка'}`,
                        jsonData: data,
                      });
                    }
                  } catch (err) {
                    setDiagnosticsModal({
                      open: true,
                      title: '❌ Помилка',
                      content: `Помилка: ${err instanceof Error ? err.message : 'Невідома помилка'}`,
                    });
                  }
                }}
                style={{
                  padding: '10px 20px',
                  background: '#f59e0b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🔬 Діагностика ManyChat API
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch('/api/altegio/reminders/test-manychat-detailed?instagram=mykolayyurashko', {
                      method: 'GET',
                    });
                    const data = await res.json();
                    if (data.ok) {
                      const successful = data.successfulResults || [];
                      const allResults = data.allResults || [];
                      
                      let message = `🔍 ДЕТАЛЬНА ДІАГНОСТИКА ManyChat API\n\n`;
                      message += `Instagram: ${data.instagram}\n`;
                      message += `API Key: ${data.apiKeyInfo?.length || 'N/A'} символів\n`;
                      message += `Знайдено: ${data.found ? '✅ Так' : '❌ Ні'}\n\n`;
                      message += `Успішні тести: ${successful.length}\n`;
                      message += `Всього тестів: ${allResults.length}\n\n`;
                      
                      if (successful.length > 0) {
                        message += `✅ Знайдено через:\n`;
                        successful.forEach((r: any) => {
                          message += `- ${r.method}: Subscriber ID ${r.subscriberId}\n`;
                        });
                      } else {
                        message += `❌ Не знайдено жодним методом\n\n`;
                        message += `Детальні результати:\n`;
                        allResults.forEach((r: any) => {
                          message += `\n${r.method}:\n`;
                          message += `  Status: ${r.status || 'N/A'} ${r.statusText || ''}\n`;
                          if (r.error) {
                            message += `  Error: ${r.error}\n`;
                          } else if (r.response) {
                            if (r.response.parsed) {
                              message += `  Response: ${JSON.stringify(r.response.parsed).substring(0, 300)}...\n`;
                            } else {
                              message += `  Response: ${r.response.raw?.substring(0, 300) || 'N/A'}...\n`;
                            }
                          }
                        });
                        
                        if (data.recommendations && data.recommendations.length > 0) {
                          message += `\n\n💡 Рекомендації:\n`;
                          data.recommendations.forEach((rec: string) => {
                            message += `${rec}\n`;
                          });
                        }
                      }
                      
                      // Показуємо в модальному вікні з можливістю копіювання
                      console.log('[ManyChat Detailed Test]', data);
                      setDiagnosticsModal({
                        open: true,
                        title: '🔍 ДЕТАЛЬНА ДІАГНОСТИКА ManyChat API',
                        content: message,
                        jsonData: data,
                      });
                    } else {
                      alert(`❌ Помилка: ${data.error || 'Невідома помилка'}`);
                    }
                  } catch (err) {
                    alert(`❌ Помилка: ${err instanceof Error ? err.message : 'Невідома помилка'}`);
                  }
                }}
                style={{
                  padding: '10px 20px',
                  background: '#8b5cf6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🔬 Детальна діагностика ManyChat API
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch('/api/altegio/reminders/fix-index', {
                      method: 'POST',
                    });
                    const data = await res.json();
                    if (data.ok) {
                      alert(`✅ ${data.message}\n${data.oldType ? `Старий тип: ${data.oldType}` : ''}\n${data.count ? `Кількість: ${data.count}` : ''}`);
                      loadRemindersQueue();
                      loadRemindersDebug();
                    } else {
                      alert(`❌ Помилка: ${data.error}`);
                    }
                  } catch (err) {
                    alert(`❌ Помилка: ${err instanceof Error ? err.message : 'Невідома помилка'}`);
                  }
                }}
                style={{
                  padding: '10px 20px',
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🔧 Виправити індекс
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch('/api/altegio/reminders/check-webhook', {
                      method: 'GET',
                    });
                    const data = await res.json();
                    if (data.ok) {
                      const events = data.lastRecordEvents || [];
                      if (events.length === 0) {
                        alert('❌ Немає останніх подій по записах. Перевір, чи налаштований webhook в Altegio.');
                      } else {
                        const lastEvent = events[0];
                        const message = `Знайдено ${events.length} останніх подій по записах.\n\nОстання подія:\n- Дата: ${new Date(lastEvent.receivedAt).toLocaleString('uk-UA')}\n- Статус: ${lastEvent.status}\n- Visit ID: ${lastEvent.visitId}\n- Дата візиту: ${lastEvent.datetime || '—'}\n- Клієнт: ${lastEvent.clientName || '—'}\n- Instagram: ${lastEvent.instagram ? '@' + lastEvent.instagram : '—'}\n\n${lastEvent.instagram === 'mykolayyurashko' ? '✅ Це тестовий клієнт!' : '❌ Це не тестовий клієнт'}`;
                        
                        if (lastEvent.instagram === 'mykolayyurashko' && lastEvent.datetime) {
                          const createJobs = confirm(message + '\n\nСтворити job\'и для цього запису?');
                          if (createJobs) {
                            try {
                              const createRes = await fetch('/api/altegio/reminders/check-webhook', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  visitId: lastEvent.visitId,
                                  datetime: lastEvent.datetime,
                                  instagram: lastEvent.instagram,
                                  clientName: lastEvent.clientName,
                                  companyId: 1169323,
                                  clientId: lastEvent.clientId,
                                }),
                              });
                              const createData = await createRes.json();
                              if (createData.ok) {
                                alert(`✅ Створено ${createData.jobsCreated.length} job'ів! Тепер оновіть чергу.`);
                                loadRemindersQueue();
                              } else {
                                alert(`❌ Помилка створення job'ів: ${createData.error}`);
                              }
                            } catch (err) {
                              alert(`❌ Помилка: ${err instanceof Error ? err.message : 'Невідома помилка'}`);
                            }
                          }
                        } else {
                          alert(message);
                        }
                      }
                    } else {
                      alert(`❌ Помилка: ${data.error}`);
                    }
                  } catch (err) {
                    alert(`❌ Помилка: ${err instanceof Error ? err.message : 'Невідома помилка'}`);
                  }
                }}
                style={{
                  padding: '10px 20px',
                  background: '#8b5cf6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🔍 Перевірити webhook
              </button>
            </div>
          </div>

          {remindersQueue.ok !== null && (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: remindersQueue.ok ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${remindersQueue.ok ? '#86efac' : '#fca5a5'}`,
                color: remindersQueue.ok ? '#166534' : '#991b1b',
              }}
            >
              {remindersQueue.ok && remindersQueue.jobs !== undefined ? (
                <div>
                  <div style={{ marginBottom: 12, fontWeight: 600 }}>
                    Знайдено нагадувань: <strong>{remindersQueue.jobs.length}</strong>
                    {remindersQueue.debug && (
                      <div style={{ fontSize: '0.85em', color: '#6b7280', marginTop: 4, fontWeight: 400 }}>
                        (В індексі: {remindersQueue.debug.indexTotal}, Після фільтру: {remindersQueue.debug.jobsAfterFilter})
                      </div>
                    )}
                  </div>

                  {remindersQueue.jobs.length === 0 ? (
                    <p style={{ margin: 0, color: '#6b7280' }}>
                      Черга порожня. Нагадування будуть створюватися автоматично при створенні/оновленні записів у Altegio.
                    </p>
                  ) : (
                    <div
                      style={{
                        maxHeight: '500px',
                        overflowY: 'auto',
                        border: '1px solid #e5e7eb',
                        borderRadius: 6,
                        padding: 8,
                      }}
                    >
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: '0.9em',
                        }}
                      >
                        <thead>
                          <tr
                            style={{
                              borderBottom: '2px solid #bae6fd',
                              textAlign: 'left',
                            }}
                          >
                            <th style={{ padding: '8px', fontWeight: 600 }}>
                              Клієнт
                            </th>
                            <th style={{ padding: '8px', fontWeight: 600 }}>
                              Instagram
                            </th>
                            <th style={{ padding: '8px', fontWeight: 600 }}>
                              Дата візиту
                            </th>
                            <th style={{ padding: '8px', fontWeight: 600 }}>
                              Відправка
                            </th>
                            <th style={{ padding: '8px', fontWeight: 600 }}>
                              Днів до візиту
                            </th>
                            <th style={{ padding: '8px', fontWeight: 600 }}>
                              Дії
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {remindersQueue.jobs.map((job, idx) => (
                            <tr
                              key={job.id}
                              style={{
                                borderBottom: '1px solid #e0e7ef',
                                backgroundColor:
                                  idx % 2 === 0 ? '#fff' : '#fafafa',
                              }}
                            >
                              <td
                                style={{ padding: '8px', fontWeight: 500 }}
                              >
                                {job.clientName || '—'}
                              </td>
                              <td
                                style={{
                                  padding: '8px',
                                  fontFamily: 'monospace',
                                  fontSize: '0.85em',
                                }}
                              >
                                {job.instagram ? (
                                  <span
                                    style={{
                                      color: '#22c55e',
                                      fontWeight: 600,
                                    }}
                                  >
                                    @{job.instagram}
                                  </span>
                                ) : (
                                  <span style={{ color: '#ef4444' }}>—</span>
                                )}
                              </td>
                              <td style={{ padding: '8px', fontSize: '0.85em' }}>
                                {new Date(job.visitDateTime).toLocaleString(
                                  'uk-UA',
                                  {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  },
                                )}
                              </td>
                              <td
                                style={{
                                  padding: '8px',
                                  fontSize: '0.85em',
                                  color: '#6b7280',
                                }}
                              >
                                {job.dueAtFormatted}
                              </td>
                              <td
                                style={{
                                  padding: '8px',
                                  fontSize: '0.85em',
                                  fontWeight: 600,
                                }}
                              >
                                {job.daysUntilVisit > 0 ? (
                                  <span style={{ color: '#f59e0b' }}>
                                    {job.daysUntilVisit} дн.
                                  </span>
                                ) : (
                                  <span style={{ color: '#ef4444' }}>
                                    Сьогодні
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '8px' }}>
                                {job.instagram ? (
                                  <button
                                    onClick={async () => {
                                      if (!confirm(`Відправити тестове повідомлення для @${job.instagram}?`)) {
                                        return;
                                      }
                                      try {
                                        const res = await fetch('/api/altegio/reminders/test-send', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ jobId: job.id }),
                                        });
                                        const data = await res.json();
                                        if (data.ok) {
                                          const methodInfo = data.method?.includes('симуляція') 
                                            ? `⚠️ ${data.method}\n\n💡 Для реальної відправки:\n1. Додай MANYCHAT_API_KEY в Vercel\n2. Переконайся, що @${data.job.instagram} взаємодіяв з ManyChat ботом`
                                            : `✅ ${data.method}`;
                                          
                                          alert(
                                            `${data.method?.includes('симуляція') ? '⚠️' : '✅'} Повідомлення відправлено!\n\n` +
                                            `Метод: ${methodInfo}\n` +
                                            `Instagram: ${data.job.instagram}\n` +
                                            `Message ID: ${data.result?.messageId || '—'}\n\n` +
                                            (data.diagnostics ? `Діагностика:\n- ManyChat API: ${data.diagnostics.manychatApiKeyConfigured ? '✅ Налаштовано' : '❌ Не налаштовано'}\n- Instagram API: ${data.diagnostics.instagramTokenConfigured ? '✅ Налаштовано' : '❌ Не налаштовано'}` : '') +
                                            (data.result?.error ? `\n\nПомилка: ${data.result.error}` : '')
                                          );
                                          loadSentReminders();
                                        } else {
                                          alert(`❌ Помилка: ${data.error}`);
                                        }
                                      } catch (err) {
                                        alert(`❌ Помилка: ${err instanceof Error ? err.message : 'Невідома помилка'}`);
                                      }
                                    }}
                                    style={{
                                      padding: '6px 12px',
                                      background: '#8b5cf6',
                                      color: '#fff',
                                      border: 'none',
                                      borderRadius: 6,
                                      fontSize: '0.85em',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    📤 Тест
                                  </button>
                                ) : (
                                  <span style={{ color: '#9ca3af', fontSize: '0.85em' }}>—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <strong>❌ Помилка:</strong>{' '}
                  {remindersQueue.error || 'Не вдалося завантажити чергу'}
                </div>
              )}
            </div>
          )}

          {remindersDebug.ok !== null && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: remindersDebug.ok ? '#f0f9ff' : '#fef2f2',
                borderRadius: 8,
                border: `1px solid ${remindersDebug.ok ? '#bae6fd' : '#fca5a5'}`,
              }}
            >
              <strong style={{ display: 'block', marginBottom: 12 }}>
                🔍 Діагностика нагадувань:
              </strong>
              
              <div style={{ marginBottom: 12 }}>
                <strong>Webhook події:</strong>
                <ul style={{ margin: '4px 0', paddingLeft: 20, fontSize: '0.9em' }}>
                  <li>Всього подій: {remindersDebug.data?.webhookEvents?.total || 0}</li>
                  <li>Подій по записах: {remindersDebug.data?.webhookEvents?.recordEvents || 0}</li>
                  {remindersDebug.data?.webhookEvents?.eventsByResource &&
                    remindersDebug.data?.webhookEvents?.eventsByResource.length > 0 && (
                      <li>
                        По ресурсах:{' '}
                        {remindersDebug.data?.webhookEvents?.eventsByResource
                          .map((e: any) => `${e.resource}: ${e.count}`)
                          .join(', ')}
                      </li>
                    )}
                </ul>
                {remindersDebug.data?.webhookEvents?.lastRecordEvents &&
                  remindersDebug.data?.webhookEvents?.lastRecordEvents.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9em' }}>
                        Останні події по записах ({remindersDebug.data?.webhookEvents?.lastRecordEvents?.length || 0})
                      </summary>
                      <div
                        style={{
                          marginTop: 8,
                          padding: 8,
                          background: '#fff',
                          borderRadius: 4,
                          fontSize: '0.85em',
                          maxHeight: '300px',
                          overflowY: 'auto',
                        }}
                      >
                        {remindersDebug.data?.webhookEvents?.lastRecordEvents?.map(
                          (event: any, idx: number) => (
                            <div
                              key={idx}
                              style={{
                                marginBottom: 8,
                                padding: 8,
                                background: '#f8fafc',
                                borderRadius: 4,
                                border: '1px solid #e0e7ef',
                              }}
                            >
                              <div>
                                <strong>Дата:</strong>{' '}
                                {new Date(event.receivedAt).toLocaleString('uk-UA')}
                              </div>
                              <div>
                                <strong>Статус:</strong> {event.status}
                              </div>
                              <div>
                                <strong>Visit ID:</strong> {event.visitId}
                              </div>
                              <div>
                                <strong>Дата візиту:</strong> {event.datetime || '—'}
                              </div>
                              <div>
                                <strong>Клієнт:</strong> {event.clientName || '—'}
                              </div>
                              <div>
                                <strong>Instagram:</strong>{' '}
                                {event.instagram ? (
                                  <span style={{ color: '#22c55e', fontWeight: 600 }}>
                                    @{event.instagram}
                                  </span>
                                ) : (
                                  <span style={{ color: '#ef4444' }}>—</span>
                                )}
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    </details>
                  )}
                {remindersDebug.data?.webhookEvents?.lastAllEvents &&
                  remindersDebug.data?.webhookEvents?.lastAllEvents.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9em' }}>
                        Всі останні webhook події ({remindersDebug.data?.webhookEvents?.lastAllEvents?.length || 0})
                      </summary>
                      <div
                        style={{
                          marginTop: 8,
                          padding: 8,
                          background: '#fff',
                          borderRadius: 4,
                          fontSize: '0.85em',
                          maxHeight: '400px',
                          overflowY: 'auto',
                        }}
                      >
                        {remindersDebug.data?.webhookEvents?.lastAllEvents?.map(
                          (event: any, idx: number) => (
                            <div
                              key={idx}
                              style={{
                                marginBottom: 8,
                                padding: 8,
                                background: event.resource === 'record' ? '#dcfce7' : '#f8fafc',
                                borderRadius: 4,
                                border: `1px solid ${
                                  event.resource === 'record' ? '#86efac' : '#e0e7ef'
                                }`,
                              }}
                            >
                              <div>
                                <strong>Дата:</strong>{' '}
                                {new Date(event.receivedAt).toLocaleString('uk-UA')}
                              </div>
                              <div>
                                <strong>Resource:</strong>{' '}
                                <span
                                  style={{
                                    color: event.resource === 'record' ? '#22c55e' : '#6b7280',
                                    fontWeight: event.resource === 'record' ? 600 : 400,
                                  }}
                                >
                                  {event.resource || '—'}
                                </span>
                              </div>
                              <div>
                                <strong>Resource ID:</strong> {event.resource_id || '—'}
                              </div>
                              <div>
                                <strong>Status:</strong> {event.status || '—'}
                              </div>
                              {event.resource === 'record' && (
                                <>
                                  <div>
                                    <strong>Дата візиту:</strong> {event.datetime || '—'}
                                  </div>
                                  <div>
                                    <strong>Клієнт:</strong> {event.clientName || '—'}
                                  </div>
                                  <div>
                                    <strong>Instagram:</strong>{' '}
                                    {event.instagram ? (
                                      <span style={{ color: '#22c55e', fontWeight: 600 }}>
                                        @{event.instagram}
                                      </span>
                                    ) : (
                                      <span style={{ color: '#ef4444' }}>—</span>
                                    )}
                                  </div>
                                </>
                              )}
                              <details style={{ marginTop: 4 }}>
                                <summary
                                  style={{ cursor: 'pointer', fontSize: '0.8em', color: '#6b7280' }}
                                >
                                  Повна структура події
                                </summary>
                                <pre
                                  style={{
                                    marginTop: 4,
                                    padding: 4,
                                    background: '#1e293b',
                                    color: '#e2e8f0',
                                    borderRadius: 2,
                                    fontSize: '0.75em',
                                    overflowX: 'auto',
                                  }}
                                >
                                  {JSON.stringify(event.fullBody || event, null, 2)}
                                </pre>
                              </details>
                            </div>
                          ),
                        )}
                      </div>
                    </details>
                  )}
              </div>

              <div style={{ marginBottom: 12 }}>
                <strong>Job'и нагадувань:</strong>
                <ul style={{ margin: '4px 0', paddingLeft: 20, fontSize: '0.9em' }}>
                  <li>Всього: {remindersDebug.data?.jobs?.total || 0}</li>
                  <li>Pending: {remindersDebug.data?.jobs?.pending || 0}</li>
                  <li>Sent: {remindersDebug.data?.jobs?.sent || 0}</li>
                  <li>Failed: {remindersDebug.data?.jobs?.failed || 0}</li>
                  <li>Canceled: {remindersDebug.data?.jobs?.canceled || 0}</li>
                </ul>
                {remindersDebug.data?.jobs?.byVisit &&
                  remindersDebug.data?.jobs?.byVisit.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9em' }}>
                        Job'и по візитах ({remindersDebug.data?.jobs?.byVisit?.length || 0})
                      </summary>
                      <div
                        style={{
                          marginTop: 8,
                          padding: 8,
                          background: '#fff',
                          borderRadius: 4,
                          fontSize: '0.85em',
                          maxHeight: '300px',
                          overflowY: 'auto',
                        }}
                      >
                        {remindersDebug.data?.jobs?.byVisit?.map((visit: any, idx: number) => (
                          <div
                            key={idx}
                            style={{
                              marginBottom: 8,
                              padding: 8,
                              background: '#f8fafc',
                              borderRadius: 4,
                              border: '1px solid #e0e7ef',
                            }}
                          >
                            <div>
                              <strong>Visit ID:</strong> {visit.visitId} ({visit.count} job'ів)
                            </div>
                            {visit.jobs.map((job: any, jIdx: number) => (
                              <div
                                key={jIdx}
                                style={{
                                  marginTop: 4,
                                  padding: 4,
                                  background: '#fff',
                                  borderRadius: 2,
                                  fontSize: '0.8em',
                                }}
                              >
                                {job.ruleId} - {job.status} - Instagram: {job.instagram || '—'} -{' '}
                                {job.dueAtFormatted}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
              </div>
            </div>
          )}
        </Card>

        <Card title="Відправлені нагадування" emoji="✅">
          <div style={{ marginBottom: 16 }}>
            <p style={{ marginBottom: 12 }}>
              Історія відправлених нагадувань клієнтам через Instagram DM. Показує останні 50 записів.
            </p>
            <button
              onClick={loadSentReminders}
              disabled={sentReminders.loading}
              style={{
                padding: '10px 20px',
                background: '#22c55e',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                cursor: sentReminders.loading ? 'not-allowed' : 'pointer',
                opacity: sentReminders.loading ? 0.6 : 1,
              }}
            >
              {sentReminders.loading ? 'Завантаження...' : 'Оновити історію'}
            </button>
          </div>

          {sentReminders.ok !== null && (
            <div>
              {sentReminders.ok ? (
                <div>
                  {sentReminders.total !== undefined && (
                    <div
                      style={{
                        marginBottom: 12,
                        padding: 12,
                        background: '#f0fdf4',
                        borderRadius: 8,
                        border: '1px solid #86efac',
                      }}
                    >
                      <strong>Знайдено відправлених повідомлень: {sentReminders.logs?.length || 0}</strong>
                      {sentReminders.total !== undefined && sentReminders.total > (sentReminders.logs?.length || 0) && (
                        <span style={{ color: '#6b7280', marginLeft: 8 }}>
                          (Всього в системі: {sentReminders.total})
                        </span>
                      )}
                    </div>
                  )}

                  {!sentReminders.logs || sentReminders.logs.length === 0 ? (
                    <p style={{ margin: 0, color: '#6b7280' }}>
                      Немає відправлених повідомлень. Нагадування будуть відображатися тут після відправки через cron job.
                    </p>
                  ) : (
                    <div
                      style={{
                        maxHeight: '500px',
                        overflowY: 'auto',
                        border: '1px solid #e5e7eb',
                        borderRadius: 6,
                        padding: 8,
                      }}
                    >
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: '0.9em',
                        }}
                      >
                        <thead>
                          <tr
                            style={{
                              borderBottom: '2px solid #86efac',
                              textAlign: 'left',
                            }}
                          >
                            <th style={{ padding: '8px', fontWeight: 600 }}>
                              Клієнт
                            </th>
                            <th style={{ padding: '8px', fontWeight: 600 }}>
                              Instagram
                            </th>
                            <th style={{ padding: '8px', fontWeight: 600 }}>
                              Дата візиту
                            </th>
                            <th style={{ padding: '8px', fontWeight: 600 }}>
                              Відправлено
                            </th>
                            <th style={{ padding: '8px', fontWeight: 600 }}>
                              Статус
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sentReminders.logs.map((log, idx) => (
                            <tr
                              key={log.jobId}
                              style={{
                                borderBottom: '1px solid #e0e7ef',
                                backgroundColor:
                                  idx % 2 === 0 ? '#fff' : '#fafafa',
                              }}
                            >
                              <td
                                style={{ padding: '8px', fontWeight: 500 }}
                              >
                                {log.clientName || '—'}
                              </td>
                              <td
                                style={{
                                  padding: '8px',
                                  fontFamily: 'monospace',
                                  fontSize: '0.85em',
                                }}
                              >
                                {log.instagram ? (
                                  <span
                                    style={{
                                      color: '#22c55e',
                                      fontWeight: 600,
                                    }}
                                  >
                                    @{log.instagram}
                                  </span>
                                ) : (
                                  <span style={{ color: '#ef4444' }}>—</span>
                                )}
                              </td>
                              <td style={{ padding: '8px', fontSize: '0.85em' }}>
                                {log.visitDateTimeFormatted}
                              </td>
                              <td
                                style={{
                                  padding: '8px',
                                  fontSize: '0.85em',
                                  color: '#6b7280',
                                }}
                              >
                                {log.timestampFormatted}
                              </td>
                              <td
                                style={{
                                  padding: '8px',
                                  fontSize: '0.85em',
                                  fontWeight: 600,
                                }}
                              >
                                {log.success ? (
                                  <span style={{ color: '#22c55e' }}>✅ Відправлено</span>
                                ) : (
                                  <span style={{ color: '#ef4444' }}>
                                    ❌ Помилка: {log.error || 'Невідома помилка'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <strong>❌ Помилка:</strong>{' '}
                  {sentReminders.error || 'Не вдалося завантажити історію'}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="📤 Експорт помилки для підтримки" emoji="📤">
          <p style={{ marginBottom: 16 }}>
            Щоб зробити скріншот для підтримки Altegio, натисніть кнопку нижче. 
            Вона покаже всі деталі помилки в одному місці.
          </p>
          <button
            onClick={async () => {
              // Отримуємо актуальні дані з діагностики
              let diagnosticsData: any = null;
              try {
                const diagRes = await fetch('/api/altegio/diagnostics', { cache: 'no-store' });
                const diagJson = await diagRes.json();
                if (diagJson.ok && diagJson.diagnostics) {
                  diagnosticsData = diagJson.diagnostics;
                }
              } catch (err) {
                console.warn('Failed to get diagnostics:', err);
              }

              // Створюємо великий блок з усіма деталями
              const companyId = diagnosticsData?.environment?.companyId || '1169323';
              const partnerToken = diagnosticsData?.environment?.partnerTokenFull || '[PARTNER_TOKEN]';
              const userTokenPreview = diagnosticsData?.environment?.userTokenPreview || '[USER_TOKEN]';
              const applicationId = diagnosticsData?.environment?.applicationId || '[APPLICATION_ID]';
              const partnerId = diagnosticsData?.environment?.partnerId || '[PARTNER_ID]';
              
              const errorDetails = {
                timestamp: new Date().toISOString(),
                companyId: companyId,
                errors: {
                  clients: clientsTestStatus.error || 'Not tested',
                  appointments: appointmentsTestStatus.error || 'Not tested',
                },
                working: {
                  companies: testStatus.ok ? '✅ Working' : '❌ Not working',
                },
                attemptedEndpoints: [
                  'POST /api/v1/clients (with company_id in body)',
                  `POST /api/v1/company/${companyId}/clients`,
                  `GET /api/v1/company/${companyId}/appointments`,
                ],
                diagnostics: diagnosticsData,
              };

              // Відкриваємо нове вікно з деталями для скріншота
              const detailsWindow = window.open('', '_blank');
              if (detailsWindow) {
                detailsWindow.document.write(`
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <title>Altegio API Error Details for Support</title>
                    <style>
                      body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        max-width: 800px;
                        margin: 40px auto;
                        padding: 20px;
                        background: #f5f5f5;
                      }
                      .card {
                        background: white;
                        padding: 30px;
                        border-radius: 8px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                        margin-bottom: 20px;
                      }
                      h1 { color: #d32f2f; margin-top: 0; }
                      h2 { color: #333; border-bottom: 2px solid #ddd; padding-bottom: 10px; }
                      .error { background: #ffebee; padding: 15px; border-radius: 4px; border-left: 4px solid #d32f2f; margin: 10px 0; }
                      .success { background: #e8f5e9; padding: 15px; border-radius: 4px; border-left: 4px solid #4caf50; margin: 10px 0; }
                      pre { background: #f5f5f5; padding: 15px; border-radius: 4px; overflow-x: auto; }
                      .info { background: #e3f2fd; padding: 15px; border-radius: 4px; margin: 10px 0; }
                    </style>
                  </head>
                  <body>
                    <div class="card">
                      <h1>🚨 Altegio API Error Report</h1>
                      <p><strong>Date:</strong> ${errorDetails.timestamp}</p>
                      <p><strong>Company ID:</strong> ${errorDetails.companyId}</p>
                    </div>

                    <div class="card">
                      <h2>✅ What Works</h2>
                      <div class="success">
                        <strong>GET /api/v1/companies</strong> - Returns company information successfully
                      </div>
                    </div>

                    <div class="card">
                      <h2>❌ What Doesn't Work</h2>
                      <div class="error">
                        <strong>POST /api/v1/clients</strong><br>
                        Error: ${errorDetails.errors.clients}
                      </div>
                      <div class="error">
                        <strong>GET /api/v1/company/1169323/appointments</strong><br>
                        Error: ${errorDetails.errors.appointments}
                      </div>
                    </div>

                    <div class="card">
                      <h2>📋 Attempted Endpoints</h2>
                      <ul>
                        ${errorDetails.attemptedEndpoints.map(e => `<li>${e}</li>`).join('')}
                      </ul>
                    </div>

                    <div class="card">
                      <h2>🔧 Request Details</h2>
                      <div class="info">
                        <strong>Authorization Header Format:</strong><br>
                        <code>${errorDetails.diagnostics?.headers?.authorization || 'Bearer [PARTNER_TOKEN], User [USER_TOKEN]'}</code>
                      </div>
                      <div class="info">
                        <strong>Headers:</strong><br>
                        <pre>Accept: application/vnd.api.v2+json
Content-Type: application/json
Authorization: ${errorDetails.diagnostics?.headers?.authorization || 'Bearer [PARTNER_TOKEN], User [USER_TOKEN]'}
X-Partner-ID: ${errorDetails.diagnostics?.headers?.xPartnerId || '[PARTNER_ID]'}
X-Application-ID: ${errorDetails.diagnostics?.headers?.xApplicationId || '[APPLICATION_ID]'}</pre>
                      </div>
                    </div>

                    <div class="card">
                      <h2>📝 Application Details</h2>
                      <pre>Application ID: ${errorDetails.diagnostics?.environment?.applicationId || '[APPLICATION_ID]'}
Partner ID: ${errorDetails.diagnostics?.environment?.partnerId || '[PARTNER_ID]'}
Company ID: ${errorDetails.companyId}
Application Type: Non-public</pre>
                    </div>
                    
                    ${errorDetails.diagnostics ? `
                    <div class="card">
                      <h2>🔍 Full Diagnostics</h2>
                      <pre>${JSON.stringify(errorDetails.diagnostics, null, 2)}</pre>
                    </div>
                    ` : ''}

                    <div class="card">
                      <h2>💡 Next Steps</h2>
                      <p>Please provide:</p>
                      <ol>
                        <li>Why API returns 403 even though permissions are enabled?</li>
                        <li>Correct endpoint and method for retrieving clients?</li>
                        <li>Any additional settings needed for non-public applications?</li>
                      </ol>
                    </div>
                  </body>
                  </html>
                `);
                detailsWindow.document.close();
                alert('Відкрито нове вікно з деталями. Зробіть скріншот цього вікна для підтримки!');
              }
            }}
            style={{
              padding: '12px 24px',
              backgroundColor: '#2a6df5',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(42, 109, 245, 0.3)',
            }}
          >
            📸 Створити звіт для підтримки
          </button>
          <p style={{ marginTop: 12, fontSize: '0.9em', color: '#666' }}>
            Кнопка відкриє нове вікно з усіма деталями помилки. Зробіть скріншот цього вікна.
          </p>
        </Card>

        <Card title="Статус" emoji="🚧">
          <p>
            Технічне завдання зафіксоване у <code>PROJECT_NOTES.md</code>. Поточний етап —
            налаштування підключення до Alteg.io API.
          </p>
        </Card>

        <Card title="Наступні кроки" emoji="✅">
          <ol style={{ margin: 0, paddingLeft: 22 }}>
            <li>Перевірити підключення до API (використовується USER_TOKEN).</li>
            <li>Отримати список компаній (салонів) для тестування.</li>
            <li>Реалізувати базові методи роботи з клієнтами та записами.</li>
            <li>Створити ETL-процес для синхронізації даних.</li>
          </ol>
        </Card>

        <Card title="Посилання" emoji="🔗">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              <Link href="/admin/analytics" style={{ color: '#2a6df5' }}>
                Перейти до майбутнього дашборду
              </Link>
            </li>
            <li>
              <Link href="/admin/debug" style={{ color: '#2a6df5' }}>
                Відкрити тестову сторінку ManyChat/KeyCRM
              </Link>
            </li>
          </ul>
        </Card>
      </section>

      {/* Модальне вікно для діагностики */}
      {diagnosticsModal.open && (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '20px',
        }}
        onClick={() => setDiagnosticsModal({ open: false, title: '', content: '' })}
      >
        <div
          style={{
            backgroundColor: '#fff',
            borderRadius: 12,
            padding: '24px',
            maxWidth: '90vw',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            position: 'relative',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{diagnosticsModal.title}</h2>
            <button
              onClick={() => setDiagnosticsModal({ open: false, title: '', content: '' })}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                padding: '0 8px',
                color: '#666',
              }}
            >
              ×
            </button>
          </div>
          
          <div style={{ marginBottom: '16px' }}>
            <button
              onClick={async () => {
                const textToCopy = diagnosticsModal.jsonData 
                  ? JSON.stringify(diagnosticsModal.jsonData, null, 2)
                  : diagnosticsModal.content;
                await navigator.clipboard.writeText(textToCopy);
                alert('✅ Скопійовано в буфер обміну!');
              }}
              style={{
                padding: '8px 16px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 500,
                marginRight: '8px',
              }}
            >
              📋 Копіювати JSON
            </button>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(diagnosticsModal.content);
                alert('✅ Текст скопійовано в буфер обміну!');
              }}
              style={{
                padding: '8px 16px',
                background: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              📋 Копіювати текст
            </button>
          </div>

          <div
            style={{
              backgroundColor: '#f9fafb',
              padding: '16px',
              borderRadius: 8,
              fontFamily: 'monospace',
              fontSize: '13px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '60vh',
              overflow: 'auto',
              border: '1px solid #e5e7eb',
            }}
          >
            {diagnosticsModal.content}
          </div>

          {diagnosticsModal.jsonData && (
            <details style={{ marginTop: '16px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 500, marginBottom: '8px' }}>
                📄 Показати повний JSON
              </summary>
              <pre
                style={{
                  backgroundColor: '#1f2937',
                  color: '#f9fafb',
                  padding: '16px',
                  borderRadius: 8,
                  overflow: 'auto',
                  fontSize: '12px',
                  maxHeight: '40vh',
                  marginTop: '8px',
                }}
              >
                {JSON.stringify(diagnosticsModal.jsonData, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
      )}
    </main>
  );
}

function Card({
  children,
  title,
  emoji,
}: {
  children: React.ReactNode;
  title: string;
  emoji?: string;
}) {
  return (
    <div
      style={{
        borderRadius: 20,
        border: '1px solid #e8ebf0',
        background: '#fff',
        boxShadow: '0 8px 26px rgba(0,0,0,0.06)',
        padding: '22px 24px',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {emoji && <span style={{ fontSize: 28 }}>{emoji}</span>}
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{title}</h2>
      </header>
      <div style={{ color: 'rgba(0,0,0,0.72)', lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}
