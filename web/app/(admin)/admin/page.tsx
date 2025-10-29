// web/app/(admin)/admin/page.tsx
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function AdminHome() {
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

        {/* Тестова сторінка */}
        <Card>
          <CardHeader
            emoji="🧪"
            title="Тестова сторінка"
            subtitle="KV-стенд, fallback та тестові інструменти"
          />
          <CardBody>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
              <li>Перевірка KV-конфігурації</li>
              <li>Огляд останніх кампаній (KV / fallback)</li>
              <li>Доступ до внутрішніх інструментів</li>
            </ul>
          </CardBody>
          <CardFooter>
            <PrimaryLink href="/admin/tools/test">Відкрити сторінку</PrimaryLink>
            <SecondaryLink href="/admin/tools">Інструменти</SecondaryLink>
          </CardFooter>
        </Card>
      </section>

      <section style={{ marginTop: 56 }}>
        <div style={{ marginBottom: 18 }}>
          <h2
            style={{
              fontSize: 32,
              fontWeight: 800,
              margin: 0,
              letterSpacing: -0.3,
            }}
          >
            Альтеджіо
          </h2>
          <p style={{ marginTop: 8, color: 'rgba(0,0,0,0.6)', maxWidth: 720 }}>
            Панель для роботи з інтеграцією Alteg.io: аналітика мережі салонів, склад волосся,
            планування та майбутні фінансові звіти.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 20,
            alignItems: 'stretch',
          }}
        >
          <Card accent>
            <CardHeader
              emoji="📊"
              title="Аналітика та склад"
              subtitle="Дашборди, склад волосся за вагою, план/факт"
            />
            <CardBody>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
                <li>Синхронізація записів, клієнтів, послуг</li>
                <li>Контроль прийомок і залишків волосся</li>
                <li>Планування завантаженості майстрів</li>
              </ul>
            </CardBody>
            <CardFooter>
              <PrimaryLink href="/admin/altegrio/analytics">Відкрити модуль</PrimaryLink>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader
              emoji="💰"
              title="Фінансові звіти"
              subtitle="P&L, контроль витрат, експортні документи"
            />
            <CardBody>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(0,0,0,0.75)' }}>
                <li>Консолідація виручки та витрат по салонах</li>
                <li>Порівняння план/факт за категоріями</li>
                <li>Експорт CSV/PDF для бухгалтерії</li>
              </ul>
            </CardBody>
            <CardFooter>
              <SecondaryLink href="/docs/analytics-dashboard-spec">Документація</SecondaryLink>
            </CardFooter>
          </Card>
        </div>
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
    <div style={{ padding: '22px 24px 10px 24px' }}>
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
    <div style={{ padding: '16px 24px 22px 24px', display: 'flex', gap: 12 }}>
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

function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-block',
        textDecoration: 'none',
        background: '#f4f6fb',
        color: '#1a2b4c',
        padding: '12px 16px',
        borderRadius: 14,
        fontWeight: 700,
        border: '1px solid #d3d9e6',
      }}
    >
      {children}
    </Link>
  );
}
