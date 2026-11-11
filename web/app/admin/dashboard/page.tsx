// Дашборд власника: головні цифри салону за обраний період. Лише перегляд, дані — з таблиць Kresco.
"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatDayShort, formatPeriod, isYmd, kyivToday } from "@/lib/dashboard/period";
import type { DashboardCash, DashboardCashAccount, DashboardData, DashboardVisitRow, VisitStatus } from "@/lib/dashboard/types";
import { Block, formatInt, formatPercent, formatUah, formatUsd, ListBlock, SectionTitle } from "./_components/blocks";
import { PeriodCalendar } from "./_components/PeriodCalendar";

const STATUS_LABEL: Record<VisitStatus, string> = {
  paid: "Оплачено",
  free: "Безкоштовна консультація",
  no_check: "Без чека",
  no_show: "Не прийшов",
  planned: "Заплановано",
  unmarked: "Не відмічено",
};

const STATUS_CLASS: Record<VisitStatus, string> = {
  paid: "bg-emerald-50 text-emerald-800",
  free: "bg-slate-100 text-slate-700",
  no_check: "bg-red-50 text-red-700",
  no_show: "bg-amber-50 text-amber-800",
  planned: "bg-blue-50 text-blue-800",
  unmarked: "bg-red-50 text-red-700",
};

const NO_DATA = "—";
const TOP_ROWS = 8;

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f6f7fb]" />}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const today = useMemo(() => kyivToday(), []);

  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const from = isYmd(fromParam) ? fromParam : today;
  const to = isYmd(toParam) && toParam >= from ? toParam : from;

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Лічильник кнопки «Оновити»: сторінка сама дані не перечитує.
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/dashboard?from=${from}&to=${to}`, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `Помилка ${res.status}`);
        }
        return json as DashboardData;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не вдалося завантажити показники");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, reloadTick]);

  // Залишки кас від періоду не залежать: вантажимо окремо, щоб не гальмувати основні цифри.
  const [cash, setCash] = useState<CashState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setCash({ status: "loading" });
    fetch("/api/admin/dashboard/cash", { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error(json?.error || `Помилка ${res.status}`);
        return json as DashboardCash;
      })
      .then((json) => {
        if (!cancelled) setCash({ status: "ready", data: json });
      })
      .catch((err) => {
        if (!cancelled) setCash({ status: "error", error: err instanceof Error ? err.message : "помилка" });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const changePeriod = useCallback(
    (nextFrom: string, nextTo: string) => {
      router.replace(`${pathname}?from=${nextFrom}&to=${nextTo}`, { scroll: false });
    },
    [router, pathname],
  );

  // Поки вантажиться новий період, старі цифри не показуємо як актуальні.
  const fresh = data && data.period.from === from && data.period.to === to ? data : null;

  return (
    <div className="min-h-screen bg-[#f6f7fb]">
      <header className="sticky top-[var(--admin-nav-h,0px)] z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-slate-900">Дашборд</h1>
            <div className="truncate text-xs tabular-nums text-slate-500">{formatPeriod(from, to)}</div>
          </div>
          <button
            type="button"
            onClick={() => setReloadTick((n) => n + 1)}
            disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Оновлюю…" : "Оновити"}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] gap-6 px-4 py-4 lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="mb-4 lg:sticky lg:top-[calc(var(--admin-nav-h,0px)+68px)] lg:mb-0 lg:self-start">
          <PeriodCalendar today={today} from={from} to={to} onChange={changePeriod} />
        </aside>

        <main className="min-w-0 pb-16">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Не вдалося завантажити показники: {error}
            </div>
          )}
          {!fresh && loading && <Skeleton />}
          {fresh && (
            <div className={loading ? "opacity-60" : undefined}>
              <DashboardBody data={fresh} cash={cash} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Завантаження">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      ))}
    </div>
  );
}

type CashState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: DashboardCash };

const CURRENCY_SIGN: Record<DashboardCashAccount["currency"], string> = { UAH: "₴", USD: "$", EUR: "€" };

function cashAmount(account: DashboardCashAccount): string {
  if (account.balance == null) return account.cash ? "старт не задано" : "банк не підключено";
  return `${formatInt(account.balance)} ${CURRENCY_SIGN[account.currency]}`;
}

/** Залишки зараз: гривнева каса — головна цифра, далі валютні каси, рахунки ФОП і завдатки. */
function CashBlock({ cash }: { cash: CashState }) {
  if (cash.status !== "ready") {
    return (
      <Block
        label="Залишки в касах"
        value={NO_DATA}
        sub={cash.status === "loading" ? "рахую…" : "не вдалося порахувати"}
        note={cash.status === "error" ? cash.error : undefined}
        noteTone="warn"
      />
    );
  }
  const { accounts, deposits } = cash.data;
  const main = accounts.find((a) => a.cash && a.currency === "UAH");
  const rest = accounts.filter((a) => a !== main);
  const withVariance = accounts.filter((a) => a.variance != null);
  return (
    <Block
      label="Залишки в касах"
      value={main ? cashAmount(main) : NO_DATA}
      sub={main ? `${main.title}: готівка в гривні` : "гривневої каси немає"}
      rows={[
        ...rest.map((a) => ({
          label: a.title,
          value: cashAmount(a),
          tone: a.balance == null ? ("muted" as const) : undefined,
        })),
        { label: `Завдатки (${formatInt(deposits.clients)} клієнтів)`, value: formatUah(deposits.balance) },
      ]}
      note={
        withVariance.length > 0
          ? `Розбіжність останньої касовки: ${withVariance
              .map((a) => `${a.title} ${a.variance! > 0 ? "+" : "−"}${formatInt(Math.abs(a.variance!))} ${CURRENCY_SIGN[a.currency]}`)
              .join(", ")}.`
          : "Готівка — за рухами каси, рахунки ФОП — баланс monobank."
      }
      noteTone={withVariance.length > 0 ? "warn" : "muted"}
    />
  );
}

function DashboardBody({ data, cash }: { data: DashboardData; cash: CashState }) {
  const { period, revenue, paid, income, visits, planned } = data;
  const future = period.isFuture;
  const cashAccounts = data.accounts.filter((a) => a.kind === "cash");
  const bankAccounts = data.accounts.filter((a) => a.kind === "bank");
  const maxService = Math.max(1, ...data.servicesDone.map((s) => s.sum));
  const maxPlanned = Math.max(1, ...data.servicesPlanned.map((s) => s.sum));
  const maxGoods = Math.max(1, ...data.goods.map((s) => s.sum));

  return (
    <>
      <SectionTitle
        title={future ? "Заплановано на період" : "Гроші за період"}
        sub={
          future
            ? "Період ще попереду: видно записи, майстрів і завантаженість. Гроші з'являться після візитів."
            : "Виручка рахується за днем візиту, тому на суму завдатків відрізняється від Фінзвіту."
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {planned.count > 0 && (
          <Block
            label="Заплановано"
            value={formatInt(planned.count)}
            sub="записів попереду"
            rows={[
              { label: "Клієнтів", value: formatInt(planned.clients) },
              { label: "Сума послуг", value: formatUah(planned.servicesSum) },
              {
                label: "У середньому на запис",
                value: formatUah(planned.servicesSum / planned.count),
                tone: "muted",
              },
            ]}
            note="Сума — лише послуги: товар стає відомий під час візиту."
          />
        )}
        <Block
          label="Виручка"
          value={future ? NO_DATA : formatUah(revenue.total)}
          sub={future ? "ще немає даних" : "усе, що надали клієнтам"}
          rows={
            future
              ? []
              : [
                  { label: "Послуги", value: formatUah(revenue.services) },
                  { label: "Товари", value: formatUah(revenue.goods) },
                  {
                    label: `Клієнтів: ${formatInt(revenue.clients)}`,
                    value: revenue.avgCheck != null ? `чек ${formatUah(revenue.avgCheck)}` : NO_DATA,
                    tone: "muted",
                  },
                ]
          }
        />
        <Block
          label="Оплачено"
          value={future ? NO_DATA : formatUah(paid.total)}
          sub={future ? "ще немає даних" : "як клієнти заплатили"}
          rows={
            future
              ? []
              : [
                  { label: "Готівка", value: formatUah(paid.cash) },
                  { label: "На рахунок", value: formatUah(paid.bank) },
                  { label: "Із завдатків", value: formatUah(paid.deposit) },
                  ...(paid.unknown > 0
                    ? [{ label: "Рахунок не вказано", value: formatUah(paid.unknown), tone: "warn" as const }]
                    : []),
                  ...(paid.debt > 0
                    ? [{ label: "Не доплачено", value: formatUah(paid.debt), tone: "warn" as const }]
                    : []),
                ]
          }
          note={
            !future && paid.unknown > 0
              ? "Неповні дані: частина оплат прийшла без каси чи рахунку. Стане точно після запуску обліку кас у Kresco."
              : undefined
          }
          noteTone="warn"
        />
        <Block
          label="Готівка по касах"
          value={future ? NO_DATA : formatUah(paid.cash)}
          sub={future ? "ще немає даних" : "надійшло за період"}
          rows={
            future
              ? []
              : cashAccounts.length > 0
                ? cashAccounts.map((a) => ({
                    label: a.title,
                    value:
                      a.currency !== "UAH" && a.amountFx != null
                        ? `${formatInt(a.amountFx)} ${a.currency === "USD" ? "$" : a.currency === "EUR" ? "€" : a.currency}`
                        : formatUah(a.amountUah),
                  }))
                : [{ label: "Готівкових оплат немає", value: NO_DATA, tone: "muted" as const }]
          }
        />
        <Block
          label="На рахунки"
          value={future ? NO_DATA : formatUah(paid.bank)}
          sub={future ? "ще немає даних" : "безготівкові оплати за період"}
          rows={
            future
              ? []
              : bankAccounts.length > 0
                ? bankAccounts.map((a) => ({ label: a.title, value: formatUah(a.amountUah) }))
                : [{ label: "Оплат на рахунки немає", value: NO_DATA, tone: "muted" as const }]
          }
        />
        <Block
          label="Дохід"
          value={future ? NO_DATA : formatUah(income.total)}
          sub={future ? "ще немає даних" : "виручка мінус собівартість товару й волосся"}
          rows={
            future
              ? []
              : [
                  { label: "Виручка", value: formatUah(revenue.total) },
                  { label: "Собівартість товарів", value: `− ${formatUah(income.goodsCost)}` },
                  { label: "Собівартість волосся", value: `− ${formatUah(income.hairCost)}` },
                ]
          }
          note={
            !future && income.missingCostLines > 0
              ? `Неповні дані: у ${formatInt(income.missingCostLines)} проданих позиціях немає собівартості, тому дохід завищений.`
              : !future
                ? "Волосся: ціна в $ за курсом дня продажу."
                : undefined
          }
          noteTone={income.missingCostLines > 0 ? "warn" : "muted"}
        />
        <Block
          label="Візити"
          value={formatInt(visits.total)}
          sub={`клієнтів: ${formatInt(visits.clients)}`}
          rows={[
            { label: "Завершені, оплачені", value: formatInt(visits.paid) },
            { label: "Не прийшли", value: formatInt(visits.noShow) },
            {
              label: "Прийшли, чека немає",
              value: formatInt(visits.noCheck),
              tone: visits.noCheck > 0 ? "warn" : undefined,
            },
            ...(visits.unmarked > 0
              ? [{ label: "День минув, не відмічено", value: formatInt(visits.unmarked), tone: "warn" as const }]
              : []),
            ...(visits.free > 0
              ? [{ label: "Безкоштовні консультації", value: formatInt(visits.free), tone: "muted" as const }]
              : []),
            ...(visits.planned > 0
              ? [{ label: "Ще попереду", value: formatInt(visits.planned), tone: "muted" as const }]
              : []),
          ]}
        />
      </div>

      <SectionTitle title="Що продали і хто працював" />
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {future ? (
          <ListBlock
            label="Заплановані послуги"
            empty="Записів на цей період ще немає"
            items={data.servicesPlanned.slice(0, TOP_ROWS).map((s) => ({
              title: s.title,
              value: formatUah(s.sum),
              meta: `${formatInt(s.count)} шт`,
              share: s.sum / maxPlanned,
            }))}
            footer={<MoreNote total={data.servicesPlanned.length} />}
          />
        ) : (
          <ListBlock
            label="Послуги"
            empty="Наданих послуг за період немає"
            items={data.servicesDone.slice(0, TOP_ROWS).map((s) => ({
              title: s.title,
              value: formatUah(s.sum),
              meta: `${formatInt(s.count)} шт`,
              share: s.sum / maxService,
            }))}
            footer={<MoreNote total={data.servicesDone.length} />}
          />
        )}
        {!future && (
          <ListBlock
            label="Товари"
            empty="Товарів за період не продавали"
            items={data.goods.slice(0, TOP_ROWS).map((s) => ({
              title: s.title,
              value: formatUah(s.sum),
              meta: `${formatInt(s.count)} шт`,
              share: s.sum / maxGoods,
            }))}
            footer={<MoreNote total={data.goods.length} />}
          />
        )}
        <ListBlock
          label="Майстри і завантаженість"
          empty="Записів у майстрів немає"
          items={data.masters.map((m) => ({
            title: m.name,
            value: formatUah(m.sum),
            meta:
              m.load != null
                ? `${formatInt(m.visits)} віз. · зайнято ${formatPercent(m.load)}`
                : `${formatInt(m.visits)} віз. · графіка немає`,
            share: m.load,
          }))}
          footer={
            <p className="mt-3 text-[11px] leading-snug text-slate-400">
              Смужка — частка зайнятого часу зміни за графіком.
            </p>
          }
        />
      </div>

      {(data.funnel || data.admin) && (
        <>
          <SectionTitle title="Шлях до клієнта і робота адміністратора" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.funnel && <Funnel funnel={data.funnel} />}
            {data.admin && (
              <>
                <Block
                  label="Записи створено"
                  value={formatInt(data.admin.created.total)}
                  sub="адміністратор за період"
                  rows={[
                    { label: "На консультацію", value: formatInt(data.admin.created.consultations) },
                    { label: "На платну послугу", value: formatInt(data.admin.created.paid) },
                  ]}
                />
                <Block
                  label="Дзвінки"
                  value={formatInt(data.admin.calls.incoming + data.admin.calls.outgoing)}
                  sub="розмов за період"
                  rows={[
                    { label: "Вхідні", value: formatInt(data.admin.calls.incoming) },
                    { label: "Вихідні", value: formatInt(data.admin.calls.outgoing) },
                    {
                      label: "Пропущені",
                      value: formatInt(data.admin.calls.missed),
                      tone: data.admin.calls.missed > 0 ? "warn" : undefined,
                    },
                  ]}
                />
                <Block
                  label="Переписки"
                  value={formatInt(data.admin.chats.clients + data.admin.chats.leads)}
                  sub="людей написали за період"
                  rows={[
                    { label: "Клієнти", value: formatInt(data.admin.chats.clients) },
                    { label: "Ліди", value: formatInt(data.admin.chats.leads) },
                    {
                      label: "Отримали відповідь",
                      value: formatInt(data.admin.chats.clientsAnswered + data.admin.chats.leadsAnswered),
                      tone: "muted",
                    },
                  ]}
                />
              </>
            )}
          </div>
        </>
      )}

      <SectionTitle title="Зараз" sub="Ці блоки не залежать від обраного періоду." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Block
          label="Сьогодні"
          value={formatInt(data.today.total)}
          sub={`записів на ${formatDayShort(period.today)}`}
          rows={[
            {
              label: `Оплачено: ${formatInt(data.today.paid.count)}`,
              value: formatUah(data.today.paid.sum),
            },
            {
              label: `У салоні, без чека: ${formatInt(data.today.inSalon.count)}`,
              value: formatUah(data.today.inSalon.sum),
              tone: data.today.inSalon.count > 0 ? "warn" : undefined,
            },
            {
              label: `Ще чекаємо: ${formatInt(data.today.waiting.count)}`,
              value: formatUah(data.today.waiting.sum),
            },
            ...(data.today.noShow > 0
              ? [{ label: "Не прийшли", value: formatInt(data.today.noShow), tone: "muted" as const }]
              : []),
          ]}
        />
        <Block
          label="Завдатки клієнтів"
          value={formatUah(data.deposits.balance)}
          sub={`на рахунках у ${formatInt(data.deposits.accounts)} клієнтів`}
          rows={
            future
              ? []
              : [
                  { label: "Поповнено за період", value: formatUah(data.deposits.topup) },
                  { label: "Списано за період", value: formatUah(data.deposits.spend) },
                ]
          }
          note={
            !future && data.deposits.topup === 0
              ? "Поповнення поки не записуються в Kresco — з'являться після запуску обліку завдатків."
              : undefined
          }
          noteTone="warn"
        />
        <Block
          label="Склад усього"
          value={formatUah(data.warehouse.totalUah)}
          sub={
            data.warehouse.totalUsd != null && data.fx.usd
              ? `≈ ${formatUsd(data.warehouse.totalUsd)} за курсом ${data.fx.usd}`
              : "за собівартістю"
          }
          rows={data.warehouse.storages.map((s) => ({
            label: s.title,
            value: s.valueUsd != null && s.valueUsd > 0 ? formatUsd(s.valueUsd) : formatUah(s.valueUah),
          }))}
          note={
            data.warehouse.storages.some((s) => s.missingCost > 0)
              ? `Без собівартості: ${formatInt(
                  data.warehouse.storages.reduce((sum, s) => sum + s.missingCost, 0),
                )} позицій — у суму не потрапили.`
              : data.warehouse.storages.some((s) => s.valueUsd != null && s.valueUsd > 0)
                ? "Волосся — в доларах, решта — у гривні."
                : "Волосся поки за гривневою собівартістю; у доларах — після прийомки в $."
          }
          noteTone={data.warehouse.storages.some((s) => s.missingCost > 0) ? "warn" : "muted"}
        />
        <CashBlock cash={cash} />
      </div>

      <SectionTitle
        title="Клієнти за період"
        sub={
          data.rowsTruncated
            ? `Показано перші ${formatInt(data.rows.length)} візитів — оберіть коротший період, щоб побачити всі.`
            : `Усі візити періоду: ${formatInt(data.rows.length)}`
        }
      />
      <VisitList rows={data.rows} multiDay={period.days > 1} />
    </>
  );
}

function MoreNote({ total }: { total: number }) {
  if (total <= TOP_ROWS) return null;
  return <p className="mt-3 text-[11px] text-slate-400">Показано {TOP_ROWS} найбільших із {formatInt(total)}.</p>;
}

function Funnel({ funnel }: { funnel: NonNullable<DashboardData["funnel"]> }) {
  const steps = [
    { label: "Нові ліди", value: funnel.newLeads },
    { label: "Переписка", value: funnel.leadsInChat },
    { label: "Запис на консультацію", value: funnel.consultBooked },
    { label: "Консультація відбулась", value: funnel.consultDone },
    { label: "Запис на платну", value: funnel.paidBooked },
  ];
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Шлях до клієнта</div>
      <ol className="mt-3 space-y-2">
        {steps.map((step) => (
          <li key={step.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-slate-700">{step.label}</span>
              <span className="font-semibold tabular-nums text-slate-900">{formatInt(step.value)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${(step.value / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function VisitList({ rows, multiDay }: { rows: DashboardVisitRow[]; multiDay: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">
        За цей період записів немає.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => (
          <li key={row.id} className="grid gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[220px_minmax(0,1fr)_170px]">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{row.client}</div>
              <div className="truncate text-xs tabular-nums text-slate-500">
                {multiDay ? `${formatDayShort(row.day).slice(0, 5)} · ` : ""}
                {row.time} · {row.master}
              </div>
            </div>
            <div className="min-w-0 text-sm leading-snug">
              <div className="text-slate-800">
                <span className="text-slate-400">Послуги: </span>
                {row.services.length > 0 ? row.services.join(", ") : "немає"}
              </div>
              <div className="text-slate-800">
                <span className="text-slate-400">Товари: </span>
                {row.goods.length > 0 ? row.goods.join(", ") : "немає"}
              </div>
            </div>
            <div className="md:text-right">
              <div className="text-sm font-semibold tabular-nums text-slate-900">{formatUah(row.sum)}</div>
              {row.payments.length > 0 && <div className="text-xs text-slate-500">{row.payments.join(", ")}</div>}
              <span
                className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[row.status]}`}
              >
                {STATUS_LABEL[row.status]}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
