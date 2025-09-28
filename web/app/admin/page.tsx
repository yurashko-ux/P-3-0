// web/app/admin/page.tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AdminHome() {
  const router = useRouter();

  // Якщо колись не було куки — middleware вже не пустить сюди.
  useEffect(() => {
    // no-op
  }, []);

  return (
    <main style={{ maxWidth: 980, margin: '48px auto', padding: '0 20px' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: -0.5, margin: 0 }}>
          Адмін-панель
        </h1>
        <p style={{ marginTop: 8, color: 'rgba(0,0,0,0.55)' }}>
          Оберіть дію: створити нову кампанію або переглянути існуючі.
        </p>
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20,
          alignItems: 'stretch',
        }}
      >
        {/* Картка: список кампаній */}
        <Card>
          <CardHeader
            title="Кампанії"
            subtitle="Перегляд та керування існуючими"
            emoji="📋"
          />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.7)' }}>
              <li>Сортування за датою</li>
              <li>Активація/деактивація</li>
              <li>Перегляд лічильників</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/admin/campaigns">Переглянути список</PrimaryLink>
          </CardFooter>
        </Card>

        {/* Картка: створити нову */}
        <Card accent>
          <CardHeader
            title="Нова кампанія"
            subtitle="Швидке створення з правилами v1/v2"
            emoji="✨"
          />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.7)' }}>
              <li>Назва та базові IDs воронки</li>
              <li>Тригери v1/v2 (equals/contains)</li>
              <li>Опційний EXP блок</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/admin/campaigns/new">Створити кампанію</PrimaryLink>
          </CardFooter>
        </Card>
      </section>

      <section style={{ marginTop: 28 }}>
        <div
          style={{
            padding: '14px 16px',
            border: '1px solid #eef0f3',
            borderRadius: 14,
            background: '#fafbfc',
          }}
        >
          <small style={{ color: 'rgba(0,0,0,0.6)' }}>
            Порада: після деплою кука мог/he зникнути — просто знову залогіньтесь через
            <code style={{ background: '#eef0f3', padding: '2px 6px', borderRadius: 6, marginLeft: 6 }}>
              /admin/login
            </code>
            .
          </small>
        </div>
      </section>
    </main>
  );
}

/* ---------- UI primitives (inline) ---------- */

function Card({
  children,
  accent = false,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        borderRadius: 18,
        border: '1px solid #eaecef',
        background: '#fff',
        boxShadow: '0 6px 20px rgba(0,0,0,0.06)',
        overflow: 'hidden',
        outline: accent ? '2px solid #2a6df5' : 'none',
        outlineOffset: -1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 260,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({
  title,
  subtitle,
  emoji,
}: {
  title: string;
  subtitle?: string;
  emoji?: string;
}) {
  return (
    <div style={{ padding: '20px 22px 8px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {emoji && <span style={{ fontSize: 26 }}>{emoji}</span>}
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{title}</h2>
      </div>
      {subtitle && (
        <p style={{ margin: '8px 0 0 0', color: 'rgba(0,0,0,0.55)' }}>{subtitle}</p>
      )}
    </div>
  );
}

function CardBody({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '8px 22px 8px 22px', flex: 1 }}>{children}</div>;
}

function CardFooter({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '16px 22px 20px 22px',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
      }}
    >
      {children}
    </div>
  );
}

function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-block',
        textDecoration: 'none',
        background: '#2a6df5',
        color: '#fff',
        padding: '12px 16px',
        borderRadius: 14,
        fontWeight: 700,
        boxShadow: '0 8px 20px rgba(42,109,245,0.35)',
      }}
    >
      {children}
    </Link>
  );
}
