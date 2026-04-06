import Image from 'next/image';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import { CopyAllRequisitesButton } from '@/components/fund/copy-all-requisites-button';
import { CopyIbanButton } from '@/components/fund/copy-iban-button';
import {
  FUND_BANK_CODE,
  FUND_BANK_NAME,
  FUND_EDRPOU,
  FUND_IBAN,
  FUND_RECIPIENT,
} from '@/lib/fund-requisites';

type NavItem = {
  href: string;
  label: string;
};

type FeatureItem = {
  title: string;
  description: string;
};

type ContactItem = {
  title: string;
  value: string;
  href?: string;
};

const palette = {
  bg: '#f3f0e8',
  surface: '#fbfaf6',
  surfaceStrong: '#ffffff',
  text: '#1f2328',
  muted: '#5e665d',
  olive: '#4d5b43',
  oliveDark: '#404c38',
  coyote: '#9b7a53',
  gold: '#b08a57',
  border: '#d8d1c3',
};

const navItems: NavItem[] = [
  { href: '/fund', label: 'Головна' },
  { href: '/fund/reports', label: 'Звіти' },
  { href: '/fund/how-to-help', label: 'Як допомогти' },
  { href: '/fund/contacts', label: 'Контакти' },
];

const containerStyle: CSSProperties = {
  maxWidth: 1160,
  margin: '0 auto',
  padding: '0 24px',
};

const panelStyle: CSSProperties = {
  background: palette.surfaceStrong,
  border: `1px solid ${palette.border}`,
  borderRadius: 28,
  boxShadow: '0 18px 60px rgba(31,35,40,0.08)',
};

const fundBootPhotos: { src: string; alt: string }[] = [
  {
    src: '/fund/boot-olive-pair.png',
    alt: 'Пара військових берців оливкового кольору з посиленою протекторною підошвою',
  },
  {
    src: '/fund/boot-tan.png',
    alt: 'Захисне взуття кольору койот з масивною підошвою',
  },
  {
    src: '/fund/boot-black.png',
    alt: 'Чорні тактичні берці для військових',
  },
  {
    src: '/fund/boot-olive-front.png',
    alt: 'Високі берці оливкового кольору, вигляд спереду',
  },
  {
    src: '/fund/boot-olive-side.png',
    alt: 'Профіль військового берця з підбитим комірцем і шнурівкою',
  },
  {
    src: '/fund/boot-cross-section.png',
    alt: 'Розріз берця: внутрішні шари та посилена підошва',
  },
];

export function FundHeader() {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        backdropFilter: 'blur(16px)',
        background: 'rgba(243,240,232,0.9)',
        borderBottom: `1px solid rgba(216,209,195,0.85)`,
      }}
    >
      <div
        style={{
          ...containerStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 20,
          minHeight: 78,
        }}
      >
        <Link
          href="/fund"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 14,
            color: palette.text,
            textDecoration: 'none',
          }}
        >
          <FundMark />
          <div>
            <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: palette.muted }}>
              Благодійний фонд
            </div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Всіх Святих</div>
          </div>
        </Link>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                textDecoration: 'none',
                color: palette.text,
                fontWeight: 600,
                padding: '10px 14px',
                borderRadius: 14,
              }}
            >
              {item.label}
            </Link>
          ))}
          <ActionLink href="/fund/how-to-help" variant="primary">
            Підтримати
          </ActionLink>
        </nav>
      </div>
    </header>
  );
}

export function FundFooter() {
  return (
    <footer style={{ marginTop: 56, borderTop: `1px solid ${palette.border}`, background: palette.surface }}>
      <div
        style={{
          ...containerStyle,
          paddingTop: 40,
          paddingBottom: 40,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 24,
        }}
      >
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <FundMark compact />
            <div>
              <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: palette.muted }}>
                Благодійний фонд
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: palette.text }}>Всіх Святих</div>
            </div>
          </div>
          <p style={{ margin: 0, color: palette.muted, lineHeight: 1.7 }}>
            Допомагаємо українським військовим через закупівлю та передачу протимінного захисного взуття на базі
            військових берців.
          </p>
        </div>

        <div>
          <FooterTitle>Навігація</FooterTitle>
          <FooterLinks items={navItems} />
        </div>

        <div>
          <FooterTitle>Швидкі дії</FooterTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ActionLink href="/fund/how-to-help" variant="primary">
              Зробити внесок
            </ActionLink>
            <ActionLink href="/fund/reports" variant="secondary">
              Переглянути звіти
            </ActionLink>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function FundHero() {
  return (
    <section style={{ ...containerStyle, paddingTop: 40, paddingBottom: 32 }}>
      <div
        style={{
          ...panelStyle,
          overflow: 'hidden',
          padding: 32,
          background:
            'linear-gradient(135deg, rgba(77,91,67,0.12) 0%, rgba(243,240,232,0.65) 45%, rgba(176,138,87,0.16) 100%)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.3fr) minmax(320px, 0.9fr)',
            gap: 28,
            alignItems: 'stretch',
          }}
        >
          <div>
            <p style={{ margin: '0 0 14px 0', color: palette.olive, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Захищаємо тих, хто захищає Україну
            </p>
            <h1 style={{ margin: 0, fontSize: 56, lineHeight: 1.05, letterSpacing: '-0.04em', color: palette.text }}>
              Благодійний фонд, що допомагає військовим із захисним протимінним взуттям.
            </h1>
            <p style={{ margin: '20px 0 0 0', color: palette.muted, fontSize: 18, lineHeight: 1.75, maxWidth: 720 }}>
              Ми закуповуємо та передаємо військовим захисне взуття на базі військових берців. Це практичне рішення,
              яке підвищує захист стопи, стійкість і мобільність у зоні ризику.
            </p>

            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 28 }}>
              <ActionLink href="/fund/how-to-help" variant="primary">
                Підтримати фонд
              </ActionLink>
              <ActionLink href="/fund/reports" variant="secondary">
                Переглянути звіти
              </ActionLink>
            </div>
          </div>

          <div
            style={{
              ...panelStyle,
              padding: 24,
              background: 'rgba(255,255,255,0.92)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: 320,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <FundMark size={84} />
              <div>
                <div style={{ fontSize: 12, color: palette.muted, textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                  Місія фонду
                </div>
                <div style={{ marginTop: 8, fontWeight: 800, fontSize: 28, lineHeight: 1.15, color: palette.text }}>
                  Добро вмикає світло там, де потрібен захист.
                </div>
              </div>
            </div>

            <div style={{ marginTop: 22, display: 'grid', gap: 12 }}>
              <MetricCard value="Протимінне" label="захисне взуття для військових" />
              <MetricCard value="3 етапи" label="збір, закупівля і передача допомоги" />
              <MetricCard value="Прозоро" label="фото та фінансові звіти як основа довіри" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FundMissionSection() {
  const features: FeatureItem[] = [
    {
      title: 'Фокус на захисті стопи',
      description: 'Допомагаємо там, де якісне захисне взуття прямо впливає на безпеку, витривалість і впевненість військового.',
    },
    {
      title: 'Практичне оснащення',
      description: 'Йдеться не про саперське спорядження, а про посилене захисне взуття на базі стандартних військових берців.',
    },
    {
      title: 'Пряма передача допомоги',
      description: 'Ми збираємо кошти, закуповуємо потрібні моделі та передаємо їх військовим із фіксацією результату.',
    },
  ];

  return (
    <Section
      eyebrow="Про фонд"
      title="Фонд працює на стику гуманітарної підтримки, практичної безпеки й довіри."
      description="Сайт має одразу пояснювати, чим саме займається фонд, чому це критично для фронту і як виглядає допомога в дії."
    >
      <CardGrid>
        {features.map((feature) => (
          <InfoCard key={feature.title} title={feature.title} description={feature.description} />
        ))}
      </CardGrid>
    </Section>
  );
}

export function FundImportanceSection() {
  return (
    <Section
      eyebrow="Чому це критично"
      title="Протимінне захисне взуття зменшує ризики травм і зберігає мобільність бійця."
      description="У публічній комунікації важливо без надмірної драматизації пояснити, що захист стопи, стійкість і можливість рухатися часто мають вирішальне значення."
    >
      <div
        style={{
          ...panelStyle,
          padding: 28,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 18,
        }}
      >
        <MetricCard value="Мобільність" label="Менше обмежень у русі та більше впевненості під час виконання завдань." />
        <MetricCard value="Стійкість" label="Посилена конструкція взуття краще працює у складних польових умовах." />
        <MetricCard value="Збережене життя" label="Фонд комунікує про результат через захист, а не через агресивні воєнні образи." />
      </div>
    </Section>
  );
}

export function FundProcessSection() {
  return (
    <Section
      eyebrow="Як ми допомагаємо"
      title="Простий і зрозумілий ланцюжок: збір, закупівля, передача."
      description="Цей блок добре працює і на головній сторінці, і як окрема narrative-структура для сторінки про фонд."
    >
      <CardGrid columns="repeat(auto-fit, minmax(240px, 1fr))">
        <InfoCard title="1. Збір коштів" description="Прозора комунікація потреби, реквізити для донату та пояснення цілі збору." />
        <InfoCard title="2. Закупівля" description="Відбір потрібних моделей захисного взуття з урахуванням практичності та надійності." />
        <InfoCard title="3. Передача військовим" description="Фото, короткий опис передачі та фіксація результату для звітності і довіри." />
      </CardGrid>
    </Section>
  );
}

export function FundBootsSection() {
  return (
    <Section
      eyebrow="Про взуття"
      title="Реальні моделі захисного взуття, яке фонд закуповує та передає військовим."
      description="Це не саперське спорядження, а посилені військові берці з протимінним захистом підошви. Нижче — фотографії тих самих типів взуття, з якими працює фонд."
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
          gap: 20,
          alignItems: 'start',
        }}
      >
        <div style={{ ...panelStyle, padding: 28, background: palette.surface }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: palette.coyote, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Навіщо це на сайті
          </div>
          <h3 style={{ margin: '12px 0 0 0', fontSize: 28, lineHeight: 1.25, color: palette.text }}>
            Прозорість починається з того, що донор бачить предмет допомоги.
          </h3>
          <p style={{ margin: '16px 0 0 0', color: palette.muted, lineHeight: 1.75 }}>
            Фото допомагають швидко зрозуміти масштаб і серйозність закупівель: міцна підошва, високий берець, матеріали
            верху. Окремий кадр з розрізом показує багатошарову конструкцію взуття.
          </p>
        </div>

        <div
          style={{
            ...panelStyle,
            padding: 24,
            background: 'linear-gradient(180deg, rgba(155,122,83,0.12) 0%, rgba(77,91,67,0.08) 100%)',
            display: 'grid',
            gap: 14,
          }}
        >
          <MiniHighlight title="Захист і мобільність" description="Підошва та конструкція розраховані на ризики у польових умовах." />
          <MiniHighlight title="Практичність" description="Взуття на базі стандартних військових берців, зручне для щоденного носіння." />
          <MiniHighlight title="Звіти" description="Після передачі публікуємо фото та фінансові підсумки зборів." />
        </div>
      </div>

      <div
        style={{
          marginTop: 22,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
          gap: 14,
        }}
      >
        {fundBootPhotos.map((photo) => (
          <BootPhoto key={photo.src} src={photo.src} alt={photo.alt} />
        ))}
      </div>
    </Section>
  );
}

/** Реквізити для донату на головній сторінці фонду */
export function FundRequisitesSection() {
  return (
    <section style={{ ...containerStyle, paddingTop: 8, paddingBottom: 24 }}>
      <div style={{ marginBottom: 18, maxWidth: 720 }}>
        <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: palette.coyote, fontWeight: 700 }}>
          Підтримка
        </div>
        <h2 style={{ margin: '10px 0 0 0', fontSize: 38, lineHeight: 1.12, color: palette.text }}>
          Реквізити для донату
        </h2>
        <p style={{ margin: '12px 0 0 0', color: palette.muted, lineHeight: 1.75, fontSize: 17 }}>
          Переказ на рахунок фонду в Кредобанку. Можна скопіювати лише IBAN або весь блок реквізитів текстом — зручно для
          мобільного банку чи повідомлення в месенджері.
        </p>
      </div>
      <DonateDetailsCard />
    </section>
  );
}

export function FundStatsSection() {
  return (
    <Section
      eyebrow="Результат у цифрах"
      title="Цифри мають швидко показувати масштаб і темп допомоги."
      description="На старті можна віддати тимчасові значення або підставити фактичні дані пізніше, не змінюючи структуру блоку."
    >
      <CardGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
        <MetricCard value="0+" label="пар взуття вже можна буде відображати тут після наповнення" />
        <MetricCard value="0+" label="передач військовим у звітному блоці" />
        <MetricCard value="100%" label="фокус на прозорості та доказовому контенті" />
      </CardGrid>
    </Section>
  );
}

export function FundReportsPreviewSection() {
  return (
    <Section
      eyebrow="Прозорість"
      title="Звіти мають бути однією з головних причин довіри до фонду."
      description="Для першої версії достатньо чіткої сторінки-хабу, а детальні наповнення можна додавати поступово."
    >
      <CardGrid>
        <InfoCard
          title="Фінансові звіти"
          description="Публічний блок із сумами зборів, витратами на закупівлю та ключовими зрізами по періодах."
          href="/fund/reports"
          hrefLabel="Перейти до звітів"
        />
        <InfoCard
          title="Фото передач"
          description="Візуальне підтвердження отримання допомоги і коротка хронологія передач."
          href="/fund/reports"
          hrefLabel="Перейти до звітів"
        />
        <InfoCard
          title="Окремі збори"
          description="За потреби сторінка з активними або завершеними зборами на конкретні партії взуття."
          href="/fund/reports"
          hrefLabel="Перейти до звітів"
        />
      </CardGrid>
    </Section>
  );
}

export function FundDonateBanner() {
  return (
    <section style={{ ...containerStyle, paddingTop: 8, paddingBottom: 40 }}>
      <div
        style={{
          ...panelStyle,
          padding: 28,
          background: `linear-gradient(135deg, ${palette.olive} 0%, ${palette.oliveDark} 100%)`,
          color: '#f8f7f2',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: 20,
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.78 }}>Підтримка фонду</div>
          <h2 style={{ margin: '10px 0 0 0', fontSize: 34, lineHeight: 1.15 }}>
            Один зрозумілий заклик до дії: допомогти закупити наступну партію захисного взуття.
          </h2>
        </div>
        <ActionLink href="/fund/how-to-help" variant="light">
          Зробити внесок
        </ActionLink>
      </div>
    </section>
  );
}

export function ReportsPageContent() {
  return (
    <PageIntro
      eyebrow="Звіти"
      title="Публічний хаб прозорості для фінансових даних, фото передач і хронології закупівель."
      description="На першому етапі ця сторінка може містити структуру і короткі описи розділів, а далі наповнюватися фактичними звітами."
    >
      <CardGrid>
        <InfoCard title="Фінансовий блок" description="Суми надходжень, витрати на партії взуття, короткий періодичний зріз." />
        <InfoCard title="Фото-звіти" description="Світлини передач, короткий контекст і дата передачі." />
        <InfoCard title="Архів зборів" description="Сторінка або список окремих цільових зборів, якщо вони ведуться." />
      </CardGrid>
      <NoticePanel>
        У майбутньому тут можна пов'язати публічні звіти з наявними внутрішніми даними, але без винесення всієї адмінської
        логіки назовні.
      </NoticePanel>
    </PageIntro>
  );
}

export function HelpPageContent() {
  return (
    <PageIntro
      eyebrow="Як допомогти"
      title="Сторінка допомоги має бути максимально прямою: мінімум шуму, чіткі реквізити, швидкий шлях до внеску."
      description="Тут варто зосередитися на простоті дії, довірі та відчутті, що внесок одразу перетворюється на захист для військових."
    >
      <CardGrid>
        <InfoCard title="Грошовий внесок" description="Основний CTA із реквізитами, банкою або кнопкою оплати для швидкого донату." />
        <InfoCard title="Партнерство" description="Співпраця з виробниками, постачальниками, бізнесами й волонтерськими спільнотами." />
        <InfoCard title="Цільова підтримка" description="Допомога на конкретну партію взуття, підрозділ або окремий збір із прозорим результатом." />
      </CardGrid>
      <div style={{ marginTop: 24 }}>
        <DonateDetailsCard />
      </div>
    </PageIntro>
  );
}

export function ContactsPageContent() {
  const contacts: ContactItem[] = [
    { title: 'Контактна особа', value: 'Зоряна Кравець' },
    { title: 'Телефон', value: '+380980584020', href: 'tel:+380980584020' },
    { title: 'Банк', value: FUND_BANK_NAME },
    { title: 'ЄДРПОУ', value: FUND_EDRPOU },
  ];

  return (
    <PageIntro
      eyebrow="Контакти"
      title="Контактна сторінка має швидко дати людині спосіб написати, зателефонувати або перевірити реквізити."
      description="Тут також доцільно вивести юридичні дані фонду, посилання на соцмережі та блок із реквізитами."
    >
      <CardGrid>
        {contacts.map((item) => (
          <ContactCard key={item.title} item={item} />
        ))}
      </CardGrid>
      <div style={{ marginTop: 24 }}>
        <DonateDetailsCard />
      </div>
    </PageIntro>
  );
}

export function FundMark({ size = 62, compact = false }: { size?: number; compact?: boolean }) {
  const width = compact ? size - 8 : size;
  const height = compact ? size - 8 : size;

  return (
    <svg width={width} height={height} viewBox="0 0 72 72" role="img" aria-label="Логотип фонду Всіх Святих">
      <defs>
        <linearGradient id="fundOlive" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5f7053" />
          <stop offset="100%" stopColor="#404c38" />
        </linearGradient>
        <linearGradient id="fundGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c4a06a" />
          <stop offset="100%" stopColor="#9b7a53" />
        </linearGradient>
      </defs>
      <path
        d="M36 5L60 14V31C60 46 50 58 36 66C22 58 12 46 12 31V14L36 5Z"
        fill="url(#fundOlive)"
        stroke="#d9cfbf"
        strokeWidth="2"
      />
      <path
        d="M36 16C42 21 46 27 46 34C46 42 41 48 36 54C31 48 26 42 26 34C26 27 30 21 36 16Z"
        fill="#f5f1e8"
        opacity="0.92"
      />
      <path d="M36 21V49" stroke="url(#fundGold)" strokeWidth="4" strokeLinecap="round" />
      <path d="M30 26H42" stroke="url(#fundGold)" strokeWidth="4" strokeLinecap="round" />
      <path d="M28 33H44" stroke="#4d5b43" strokeWidth="3" strokeLinecap="round" />
      <path d="M28 40H44" stroke="#4d5b43" strokeWidth="3" strokeLinecap="round" />
      <circle cx="36" cy="54" r="3" fill="url(#fundGold)" />
    </svg>
  );
}

function FooterTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: palette.muted, marginBottom: 12 }}>{children}</div>;
}

function FooterLinks({ items }: { items: NavItem[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((item) => (
        <Link key={item.href} href={item.href} style={{ color: palette.text, textDecoration: 'none', fontWeight: 600 }}>
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function ActionLink({
  href,
  children,
  variant,
}: {
  href: string;
  children: ReactNode;
  variant: 'primary' | 'secondary' | 'light';
}) {
  const common: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    borderRadius: 16,
    padding: '14px 18px',
    fontWeight: 800,
  };

  const stylesByVariant: Record<'primary' | 'secondary' | 'light', CSSProperties> = {
    primary: {
      background: palette.olive,
      color: '#fff',
      boxShadow: '0 14px 30px rgba(77,91,67,0.24)',
    },
    secondary: {
      background: '#fff',
      color: palette.text,
      border: `1px solid ${palette.border}`,
    },
    light: {
      background: '#f8f7f2',
      color: palette.oliveDark,
    },
  };

  return (
    <Link href={href} style={{ ...common, ...stylesByVariant[variant] }}>
      {children}
    </Link>
  );
}

function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section style={{ ...containerStyle, paddingTop: 16, paddingBottom: 16 }}>
      <div style={{ marginBottom: 22, maxWidth: 760 }}>
        <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: palette.coyote, fontWeight: 700 }}>
          {eyebrow}
        </div>
        <h2 style={{ margin: '10px 0 0 0', fontSize: 42, lineHeight: 1.12, color: palette.text }}>{title}</h2>
        <p style={{ margin: '14px 0 0 0', color: palette.muted, lineHeight: 1.75, fontSize: 17 }}>{description}</p>
      </div>
      {children}
    </section>
  );
}

function PageIntro({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div style={{ background: palette.bg }}>
      <section style={{ ...containerStyle, paddingTop: 36, paddingBottom: 24 }}>
        <div style={{ ...panelStyle, padding: 30 }}>
          <div style={{ maxWidth: 820 }}>
            <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: palette.coyote, fontWeight: 700 }}>
              {eyebrow}
            </div>
            <h1 style={{ margin: '12px 0 0 0', fontSize: 50, lineHeight: 1.06, color: palette.text }}>{title}</h1>
            <p style={{ margin: '16px 0 0 0', color: palette.muted, lineHeight: 1.75, fontSize: 18 }}>{description}</p>
          </div>
          <div style={{ marginTop: 28 }}>{children}</div>
        </div>
      </section>
    </div>
  );
}

function CardGrid({
  children,
  columns = 'repeat(auto-fit, minmax(260px, 1fr))',
}: {
  children: ReactNode;
  columns?: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: columns,
        gap: 18,
      }}
    >
      {children}
    </div>
  );
}

function InfoCard({
  title,
  description,
  href,
  hrefLabel,
}: {
  title: string;
  description: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div style={{ ...panelStyle, padding: 24, background: palette.surfaceStrong }}>
      <h3 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, color: palette.text }}>{title}</h3>
      <p style={{ margin: '12px 0 0 0', color: palette.muted, lineHeight: 1.7 }}>{description}</p>
      {href && hrefLabel ? (
        <div style={{ marginTop: 18 }}>
          <Link href={href} style={{ color: palette.olive, textDecoration: 'none', fontWeight: 800 }}>
            {hrefLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ ...panelStyle, padding: 24, background: palette.surfaceStrong }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: palette.olive }}>{value}</div>
      <p style={{ margin: '10px 0 0 0', color: palette.muted, lineHeight: 1.7 }}>{label}</p>
    </div>
  );
}

function MiniHighlight({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.82)', borderRadius: 18, border: `1px solid ${palette.border}`, padding: 16 }}>
      <div style={{ fontWeight: 800, color: palette.text }}>{title}</div>
      <div style={{ marginTop: 6, color: palette.muted, lineHeight: 1.65 }}>{description}</div>
    </div>
  );
}

function NoticePanel({ children }: { children: ReactNode }) {
  return (
    <div style={{ ...panelStyle, marginTop: 22, padding: 22, background: '#faf7f0', color: palette.muted, lineHeight: 1.7 }}>
      {children}
    </div>
  );
}

function DonateDetailsCard() {
  const detailRows = [
    { label: 'Банк', value: FUND_BANK_NAME },
    { label: 'Код банку', value: FUND_BANK_CODE },
    { label: 'Отримувач', value: FUND_RECIPIENT },
    { label: 'Код ЄДРПОУ', value: FUND_EDRPOU },
  ];

  return (
    <div style={{ ...panelStyle, padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          padding: '26px 28px',
          background: `linear-gradient(125deg, ${palette.olive} 0%, ${palette.oliveDark} 55%, #2d3528 100%)`,
          color: '#f8f7f2',
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.85, fontWeight: 700 }}>
          Офіційний рахунок
        </div>
        <p style={{ margin: '12px 0 0 0', fontSize: 17, lineHeight: 1.65, opacity: 0.95, maxWidth: 640 }}>
          Офіційний рахунок благодійної організації в Кредобанку. У призначенні платежу вкажіть «Благодійний внесок» або
          мету збору, якщо він оголошений окремо.
        </p>
      </div>

      <div style={{ padding: 24, background: palette.surface }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'stretch',
            justifyContent: 'space-between',
            gap: 18,
            padding: '20px 22px',
            borderRadius: 20,
            background: '#1f2328',
            color: '#f8f7f2',
            border: `1px solid ${palette.border}`,
          }}
        >
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.65, fontWeight: 700 }}>
              IBAN
            </div>
            <div
              style={{
                marginTop: 8,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 17,
                fontWeight: 800,
                letterSpacing: '0.04em',
                lineHeight: 1.45,
                wordBreak: 'break-all',
              }}
            >
              {FUND_IBAN}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
              flexShrink: 0,
            }}
          >
            <CopyIbanButton />
            <CopyAllRequisitesButton />
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
            gap: 12,
          }}
        >
          {detailRows.map((row) => (
            <div
              key={row.label}
              style={{
                background: palette.surfaceStrong,
                border: `1px solid ${palette.border}`,
                borderRadius: 16,
                padding: '16px 18px',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: palette.muted,
                  fontWeight: 700,
                }}
              >
                {row.label}
              </div>
              <div style={{ marginTop: 8, color: palette.text, lineHeight: 1.55, fontWeight: 700 }}>{row.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BootPhoto({ src, alt }: { src: string; alt: string }) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '4 / 3',
        borderRadius: 20,
        overflow: 'hidden',
        border: `1px solid ${palette.border}`,
        background: '#fff',
        boxShadow: '0 12px 36px rgba(31,35,40,0.07)',
      }}
    >
      <Image src={src} alt={alt} fill sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 320px" style={{ objectFit: 'cover' }} />
    </div>
  );
}

function ContactCard({ item }: { item: ContactItem }) {
  const content = (
    <>
      <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: palette.muted, fontWeight: 700 }}>
        {item.title}
      </div>
      <div style={{ marginTop: 10, fontSize: 22, lineHeight: 1.35, fontWeight: 800, color: palette.text }}>{item.value}</div>
    </>
  );

  if (item.href) {
    return (
      <Link href={item.href} style={{ ...panelStyle, padding: 24, textDecoration: 'none', display: 'block', background: palette.surfaceStrong }}>
        {content}
      </Link>
    );
  }

  return (
    <div style={{ ...panelStyle, padding: 24, background: palette.surfaceStrong }}>
      {content}
    </div>
  );
}
