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
                  {testStatus.error}
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
