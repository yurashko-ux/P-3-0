// web/app/(admin)/admin/page.tsx
"use client";

import Link from 'next/link';
import { useState, useEffect } from 'react';

type Permissions = Record<string, string>;

export default function AdminHome() {
  const [permissions, setPermissions] = useState<Permissions | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.ok && data.permissions) setPermissions(data.permissions);
        else if (!cancelled) setPermissions({});
      })
      .catch(() => {
        if (!cancelled) setPermissions({});
      });
    return () => { cancelled = true; };
  }, []);

  const showDebug = permissions == null || permissions.debugSection !== 'none';
  const showAccess = permissions == null || permissions.accessSection !== 'none';
  const showFinanceReport = permissions == null || permissions.financeReportSection !== 'none';
  const showBank = permissions == null || permissions.bankSection !== 'none';

  return (
    <main style={{ maxWidth: 1040, margin: '48px auto', padding: '0 20px' }}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: -0.5, margin: 0 }}>
          Адмін-панель
        </h1>
        <p style={{ marginTop: 10, color: 'rgba(0,0,0,0.55)' }}>
          Оберіть дію: створити нову кампанію або переглянути існуючі.
        </p>
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 20,
          alignItems: 'stretch',
        }}
      >
        {/* Direct Manager */}
        <Card>
          <CardHeader
            emoji="💬"
            title="Direct"
            subtitle="Робота з клієнтами Instagram Direct"
          />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
              <li>Автоматичне підтягування з ManyChat</li>
              <li>Статуси та призначення майстрів</li>
              <li>Відстеження конверсії</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/admin/direct">Відкрити модуль</PrimaryLink>
          </CardFooter>
        </Card>

        {/* Кампанії — список */}
        <Card>
          <CardHeader emoji="📋" title="Кампанії" subtitle="Перегляд та керування" />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
              <li>Сортування за датою</li>
              <li>Активація / деактивація</li>
              <li>Лічильники v1 / v2 / EXP</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/admin/campaigns">Переглянути список</PrimaryLink>
          </CardFooter>
        </Card>

        {/* Нова кампанія */}
        <Card accent>
          <CardHeader emoji="✨" title="Нова кампанія" subtitle="Швидке створення з правилами v1/v2" />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
              <li>Назва, базові ID воронки</li>
              <li>Тригери (equals / contains)</li>
              <li>Опційний EXP-блок</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/admin/campaigns/new">Створити кампанію</PrimaryLink>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader
            emoji="🛡️"
            title="Сайт благодійного фонду"
            subtitle="Публічний розділ фонду «Всіх Святих»"
          />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
              <li>Головна сторінка фонду</li>
              <li>Звіти, контакти та сторінка допомоги</li>
              <li>База для майбутнього окремого домену</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/fund" newTab>Відкрити сайт</PrimaryLink>
          </CardFooter>
        </Card>
        {/* Тестова / debug — тільки якщо є право */}
        {showDebug && (
        <Card>
          <CardHeader
            emoji="🧪"
            title="Тестова сторінка"
            subtitle="KV-стан, fallback та інструменти"
          />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
              <li>Перевірка KV-конфігурації</li>
              <li>Останні кампанії (KV / fallback)</li>
              <li>Швидкий перехід до тестових інструментів</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/admin/debug">Відкрити debug</PrimaryLink>
            <SecondaryLink href="/admin/tools">Інструменти</SecondaryLink>
          </CardFooter>
        </Card>
        )}

        {/* Аналітика Alteg.io */}
        <Card>
          <CardHeader
            emoji="📊"
            title="Альтеджіо"
            subtitle="Аналітика, план/факт, нагадування"
          />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
              <li>Синхронізація даних Alteg.io</li>
              <li>План/факт та склад волосся</li>
              <li>Нагадування через ManiChat</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/admin/altegio">Відкрити модуль</PrimaryLink>
            <SecondaryLink href="/admin/analytics">Переглянути дашборд</SecondaryLink>
          </CardFooter>
        </Card>

        {/* Фото-звіти */}
        <Card>
          <CardHeader
            emoji="📸"
            title="Фото-звіти"
            subtitle="Тестування та аналітика по майстрах"
          />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
              <li>Тестові нагадування в Telegram</li>
              <li>Аналітика по майстрах</li>
              <li>Останні фото-звіти</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/admin/photo-reports">Відкрити модуль</PrimaryLink>
          </CardFooter>
        </Card>

        {/* Доступи — тільки якщо є право */}
        {showAccess && (
        <Card>
          <CardHeader
            emoji="🔐"
            title="Доступи"
            subtitle="Права та доступ для працівників"
          />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
              <li>Користувачі та посади</li>
              <li>Налаштування прав доступу</li>
              <li>Історія змін по клієнтах</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/admin/access">Відкрити</PrimaryLink>
          </CardFooter>
        </Card>
        )}

        {/* Фінансовий звіт — тільки якщо є право */}
        {showFinanceReport && (
        <Card>
          <CardHeader
            emoji="💰"
            title="Фінансовий звіт"
            subtitle="Виручка, послуги, товари, середній чек"
          />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
              <li>Сумарна виручка за період</li>
              <li>Розбивка: послуги / товари</li>
              <li>Середній чек та динаміка по днях</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/admin/finance-report" newTab>Відкрити звіт</PrimaryLink>
          </CardFooter>
        </Card>
        )}

        {/* Банк — підключення рахунків та виписки */}
        {showBank && (
        <Card>
          <CardHeader
            emoji="🏦"
            title="Банк"
            subtitle="Рахунки monobank, виписки та вебхуки"
          />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
              <li>Підключення рахунків по API</li>
              <li>Виписки по рахунках</li>
              <li>Webhook для нових транзакцій</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/admin/bank">Відкрити модуль</PrimaryLink>
          </CardFooter>
        </Card>
        )}
      </section>
    </main>
  );
}

/* ===== Прості UI-примітиви ===== */

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
        borderRadius: 20,
        border: '1px solid #e8ebf0',
        background: '#fff',
        boxShadow: '0 8px 26px rgba(0,0,0,0.06)',
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
    <div style={{ padding: '10px 24px 10px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {emoji && <span style={{ fontSize: 28 }}>{emoji}</span>}
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{title}</h2>
      </div>
      {subtitle && (
        <p style={{ margin: '8px 0 0 0', color: 'rgba(0,0,0,0.55)' }}>{subtitle}</p>
      )}
    </div>
  );
}

function CardBody({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '10px 24px', flex: 1 }}>{children}</div>;
}

function CardFooter({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '3px 5px 4px 5px', display: 'flex', gap: 12 }}>
      {children}
    </div>
  );
}

function PrimaryLink({ href, children, newTab = false }: { href: string; children: React.ReactNode; newTab?: boolean }) {
  return (
    <Link
      href={href}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener noreferrer' : undefined}
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

function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-block',
        textDecoration: 'none',
        background: '#f3f5f9',
        color: '#1c2534',
        padding: '12px 16px',
        borderRadius: 14,
        fontWeight: 600,
        border: '1px solid rgba(0,0,0,0.08)',
      }}
    >
      {children}
    </Link>
  );
}
