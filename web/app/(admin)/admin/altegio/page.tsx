// web/app/(admin)/admin/altegio/page.tsx
// Заглушка для майбутнього модуля інтеграції з Alteg.io.

import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function AltegioLanding() {
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
        <Card title="Статус" emoji="🚧">
          <p>
            Технічне завдання зафіксоване у <code>PROJECT_NOTES.md</code>. Поточний етап — збір вимог та
            підтвердження доступів до Alteg.io API.
          </p>
        </Card>

        <Card title="Дії на старті" emoji="✅">
          <ol style={{ margin: 0, paddingLeft: 22 }}>
            <li>Уточнити механізм авторизації Alteg.io (OAuth чи API token).</li>
            <li>Підтвердити вибір СУБД для сховища (PostgreSQL/Supabase).</li>
            <li>Підготувати тестовий токен та список салонів/майстрів для первинного імпорту.</li>
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
