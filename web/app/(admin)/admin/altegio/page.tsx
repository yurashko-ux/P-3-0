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
    error?: string;
  }>({ loading: false, ok: null });
  
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWebhookUrl(`${window.location.origin}/api/altegio/webhook`);
    }
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
        error: data.error,
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
              {testStatus.error && (
                <div style={{ marginTop: 8, fontSize: '0.9em', opacity: 0.9 }}>
                  <div style={{ marginBottom: 8 }}>{testStatus.error}</div>
                  {(testStatus.error.includes('Partner ID') || testStatus.error.includes('partner') || testStatus.error.includes('401')) && (
                    <div style={{ marginTop: 12, padding: 12, background: '#fff3cd', borderRadius: 6, border: '1px solid #ffc107' }}>
                      <strong>💡 Як знайти Partner Token / Application ID:</strong>
                      <p style={{ margin: '8px 0', fontSize: '0.9em' }}>
                        Для додатків у маркетплейсі Alteg.io обов'язково потрібен Partner Token (Application ID), навіть якщо є User Token з налаштованими правами доступу.
                      </p>
                      <p style={{ margin: '8px 0', fontSize: '0.9em', fontWeight: 600 }}>
                        Варіант 1: Application ID з налаштувань додатку
                      </p>
                      <ol style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                        <li>Відкрийте <a href="https://marketplace.alteg.io" target="_blank" rel="noopener noreferrer" style={{ color: '#2a6df5' }}>Alteg.io Marketplace</a></li>
                        <li>Перейдіть в "Мої програми" → ваш додаток</li>
                        <li>Відкрийте розділ <strong>"Загальна інформація"</strong></li>
                        <li>Знайдіть <strong>Application ID</strong> (може бути числовий, наприклад: #1169323, або UUID)</li>
                        <li>Скопіюйте його та додайте як змінну середовища <code>ALTEGIO_PARTNER_TOKEN</code> в Vercel</li>
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
