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
  
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

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
        </Card>

        <Card title="Календар записів" emoji="📅">
          <div style={{ marginBottom: 16 }}>
            <p style={{ marginBottom: 12 }}>
              Отримання майбутніх записів з календаря (на наступні 30 днів). Перевірка наявності Instagram username у клієнтів.
            </p>
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
        </Card>

        <Card title="📤 Експорт помилки для підтримки" emoji="📤">
          <p style={{ marginBottom: 16 }}>
            Щоб зробити скріншот для підтримки Altegio, натисніть кнопку нижче. 
            Вона покаже всі деталі помилки в одному місці.
          </p>
          <button
            onClick={() => {
              // Створюємо великий блок з усіма деталями
              const errorDetails = {
                timestamp: new Date().toISOString(),
                companyId: process.env.NEXT_PUBLIC_ALTEGIO_COMPANY_ID || '1169323',
                errors: {
                  clients: clientsTestStatus.error || 'Not tested',
                  appointments: appointmentsTestStatus.error || 'Not tested',
                },
                working: {
                  companies: testStatus.ok ? '✅ Working' : '❌ Not working',
                },
                attemptedEndpoints: [
                  'POST /api/v1/clients (with company_id in body)',
                  'POST /api/v1/company/1169323/clients',
                  'GET /api/v1/company/1169323/appointments',
                ],
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
                        <code>Bearer 48kfgfmy8s7u84ruhtju, User [USER_TOKEN]</code>
                      </div>
                      <div class="info">
                        <strong>Headers:</strong><br>
                        <pre>Accept: application/vnd.api.v2+json
Content-Type: application/json
Authorization: Bearer 48kfgfmy8s7u84ruhtju, User [USER_TOKEN]
X-Partner-ID: 784
X-Application-ID: 1195</pre>
                      </div>
                    </div>

                    <div class="card">
                      <h2>📝 Application Details</h2>
                      <pre>Application ID: 1195
Partner ID: 784
Company ID: 1169323
Application Type: Non-public</pre>
                    </div>

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
