// Обігові кошти: «Де гроші» (кільце), «Чиї гроші» (смуга) і графік по днях від першого знімка.
// База — долар за робочим курсом дня; перемикач показує те саме в гривні.
"use client";

import { useMemo, useState, type MouseEvent } from "react";
import type { DashboardWorkingCapital, WorkingCapitalPoint } from "@/lib/dashboard/types";
import { formatDayShort } from "@/lib/dashboard/period";
import { formatInt } from "./blocks";

export type WorkingCapitalState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: DashboardWorkingCapital };

type Unit = "USD" | "UAH";

// Порядок кольорів перевірено на розрізнення (у т.ч. для дальтоніків) для сусідніх сегментів кільця.
const SEGMENT_COLOR = {
  hair: "#eb6834",
  goods: "#6250d6",
  cashUah: "#1baf7a",
  cashUsd: "#2a78d6",
  cashEur: "#eda100",
  bank: "#008300",
} as const;

const OWN_COLOR = "#2a78d6";
const FOREIGN_COLOR = "#eb6834";

type Segment = { key: keyof typeof SEGMENT_COLOR; label: string; group: string; usd: number };

function money(valueUsd: number, unit: Unit, usdRate: number): string {
  return unit === "USD" ? `${formatInt(valueUsd)} $` : `${formatInt(valueUsd * usdRate)} ₴`;
}

function share(part: number, total: number): string {
  if (!(total > 0)) return "—";
  const pct = (part / total) * 100;
  return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

export function WorkingCapitalSection({ state }: { state: WorkingCapitalState }) {
  const [unit, setUnit] = useState<Unit>("USD");

  if (state.status !== "ready") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        {state.status === "loading" ? "Рахую обігові кошти…" : `Не вдалося порахувати обігові кошти: ${state.error}`}
      </div>
    );
  }
  const { now, history } = state.data;
  if (!now) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Немає робочого курсу долара — обігові кошти порахуються, щойно курс дня зафіксується.
      </div>
    );
  }

  const { parts, usdRate, eurRate } = now;
  const segments: Segment[] = [
    { key: "hair", label: "Волосся", group: "Товар", usd: parts.hairUsd },
    { key: "goods", label: "Інші товари", group: "Товар", usd: parts.goodsUah / usdRate },
    { key: "cashUah", label: "Каса ₴", group: "Каси", usd: parts.cashUah / usdRate },
    { key: "cashUsd", label: "Каса $", group: "Каси", usd: parts.cashUsd },
    { key: "cashEur", label: "Каса €", group: "Каси", usd: (parts.cashEur * eurRate) / usdRate },
    {
      key: "bank",
      label: "Рахунки ФОП",
      group: "Рахунки",
      usd: (parts.bankUah + parts.bankEur * eurRate) / usdRate + parts.bankUsd,
    },
  ];
  const depositsUsd = parts.depositsUah / usdRate;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Обігові кошти зараз</div>
          <div className="text-[28px] font-semibold leading-tight tabular-nums text-slate-900">
            {money(now.totalUsd, unit, usdRate)}
          </div>
          <div className="text-xs text-slate-500">
            власні {money(now.ownUsd, unit, usdRate)} · курс $ {usdRate}, € {eurRate}
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm" role="group" aria-label="Валюта">
          {(["USD", "UAH"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              aria-pressed={unit === u}
              className={`rounded-md px-3 py-1 font-medium ${unit === u ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {u === "USD" ? "$" : "₴"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <WhereBlock segments={segments} totalUsd={now.totalUsd} unit={unit} usdRate={usdRate} />
        <WhoseBlock totalUsd={now.totalUsd} depositsUsd={depositsUsd} unit={unit} usdRate={usdRate} />
      </div>

      <TrendBlock history={history} now={now} unit={unit} />
    </div>
  );
}

function WhereBlock({ segments, totalUsd, unit, usdRate }: { segments: Segment[]; totalUsd: number; unit: Unit; usdRate: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const positive = segments.filter((s) => s.usd > 0);
  const ringTotal = positive.reduce((sum, s) => sum + s.usd, 0);
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  // 2 px проміжку між сегментами.
  const gap = positive.length > 1 ? 2 : 0;
  let offset = 0;
  const arcs = positive.map((s) => {
    const length = ringTotal > 0 ? (s.usd / ringTotal) * circumference : 0;
    const arc = { ...s, dash: Math.max(0, length - gap), offset };
    offset += length;
    return arc;
  });
  const active = hover ? segments.find((s) => s.key === hover) : null;
  const groups = ["Товар", "Каси", "Рахунки"];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Де гроші</div>
      <div className="mt-3 flex items-center gap-4">
        <svg viewBox="0 0 160 160" className="h-36 w-36 shrink-0" role="img" aria-label="Розподіл обігових коштів">
          <circle cx="80" cy="80" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="22" />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={SEGMENT_COLOR[a.key]}
              strokeWidth={hover === a.key ? 26 : 22}
              strokeDasharray={`${a.dash} ${circumference - a.dash}`}
              strokeDashoffset={-a.offset}
              transform="rotate(-90 80 80)"
              onMouseEnter={() => setHover(a.key)}
              onMouseLeave={() => setHover(null)}
              className="cursor-default transition-[stroke-width]"
            />
          ))}
          <text x="80" y="76" textAnchor="middle" className="fill-slate-500 text-[10px]">
            {active ? active.label : "усього"}
          </text>
          <text x="80" y="94" textAnchor="middle" className="fill-slate-900 text-[15px] font-semibold tabular-nums">
            {money(active ? active.usd : totalUsd, unit, usdRate)}
          </text>
        </svg>
        <div className="min-w-0 flex-1 space-y-2.5 text-sm">
          {groups.map((group) => {
            const rows = segments.filter((s) => s.group === group);
            const sum = rows.reduce((acc, s) => acc + s.usd, 0);
            return (
              <div key={group}>
                <div className="flex items-baseline justify-between gap-3 text-xs font-medium text-slate-500">
                  <span>{group}</span>
                  <span className="tabular-nums">
                    {money(sum, unit, usdRate)} · {share(sum, totalUsd)}
                  </span>
                </div>
                {rows.map((s) => (
                  <div
                    key={s.key}
                    className={`mt-1 flex items-center justify-between gap-3 rounded px-1 ${hover === s.key ? "bg-slate-50" : ""}`}
                    onMouseEnter={() => setHover(s.key)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <span className="flex min-w-0 items-center gap-2 text-slate-700">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SEGMENT_COLOR[s.key] }} />
                      <span className="whitespace-nowrap">{s.label}</span>
                    </span>
                    <span className="whitespace-nowrap tabular-nums text-slate-900">
                      {money(s.usd, unit, usdRate)} <span className="text-slate-400">{share(s.usd, totalUsd)}</span>
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-slate-100 pt-3 text-sm">
        <span className="text-slate-500">Обладнання (інвентарний склад)</span>
        <span className="tabular-nums text-slate-400">{money(0, unit, usdRate)}</span>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-400">
        Обладнання в обігові не входить: з&apos;явиться після прийомки на інвентарний склад. Матеріали не рахуємо — це
        розхід. Еквайринг — разом із рахунками.
      </p>
    </section>
  );
}

function WhoseBlock({ totalUsd, depositsUsd, unit, usdRate }: { totalUsd: number; depositsUsd: number; unit: Unit; usdRate: number }) {
  const ownUsd = totalUsd - depositsUsd;
  const ownShare = totalUsd > 0 ? Math.max(0, Math.min(1, ownUsd / totalUsd)) : 0;
  const pending = [
    { label: "Зарплата до виплати", note: "з переходом на Kresco" },
    { label: "Борги постачальникам", note: "уточнюємо" },
  ];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Чиї гроші</div>
      <div className="mt-4 flex h-6 w-full gap-0.5 overflow-hidden rounded-md" role="img" aria-label="Власні та чужі гроші">
        <div style={{ width: `${ownShare * 100}%`, background: OWN_COLOR }} title={`Власні: ${money(ownUsd, unit, usdRate)}`} />
        <div className="flex-1" style={{ background: FOREIGN_COLOR }} title={`Завдатки: ${money(depositsUsd, unit, usdRate)}`} />
      </div>
      <dl className="mt-4 space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-2 text-slate-700">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: OWN_COLOR }} />
            Власні
          </dt>
          <dd className="tabular-nums font-medium text-slate-900">
            {money(ownUsd, unit, usdRate)} <span className="font-normal text-slate-400">{share(ownUsd, totalUsd)}</span>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-2 text-slate-700">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: FOREIGN_COLOR }} />
            Завдатки клієнтів
          </dt>
          <dd className="tabular-nums text-slate-900">
            {money(depositsUsd, unit, usdRate)} <span className="text-slate-400">{share(depositsUsd, totalUsd)}</span>
          </dd>
        </div>
        {pending.map((p) => (
          <div key={p.label} className="flex items-baseline justify-between gap-3">
            <dt className="pl-[18px] text-slate-500">{p.label}</dt>
            <dd className="text-right text-xs text-slate-400">{p.note}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] leading-snug text-slate-400">
        Завдатки — гроші клієнтів, які ще треба відпрацювати. Власні = усі обігові мінус чужі.
      </p>
    </section>
  );
}

function TrendBlock({
  history,
  now,
  unit,
}: {
  history: WorkingCapitalPoint[];
  now: WorkingCapitalPoint;
  unit: Unit;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // Сьогоднішня точка — живий розрахунок, доки вечірній знімок її не зафіксує.
  const points = useMemo(
    () => [...history.filter((p) => p.kyivDay !== now.kyivDay), now].sort((a, b) => a.kyivDay.localeCompare(b.kyivDay)),
    [history, now],
  );
  const value = (p: WorkingCapitalPoint) => (unit === "USD" ? p.totalUsd : p.totalUsd * p.usdRate);
  const label = (v: number) => (unit === "USD" ? `${formatInt(v)} $` : `${formatInt(v)} ₴`);

  const W = 640;
  const H = 200;
  const pad = { left: 64, right: 16, top: 12, bottom: 26 };
  const maxValue = Math.max(1, ...points.map(value));
  // Шкала від нуля: стабільні обігові мають виглядати рівною лінією, а не «гойдалкою».
  const step = niceStep(maxValue / 4);
  const yMax = Math.ceil(maxValue / step) * step;
  const x = (i: number) =>
    points.length > 1 ? pad.left + (i / (points.length - 1)) * (W - pad.left - pad.right) : (pad.left + W - pad.right) / 2;
  const y = (v: number) => pad.top + (1 - v / yMax) * (H - pad.top - pad.bottom);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(value(p)).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHoverIndex(best);
  }

  const active = hoverIndex != null ? points[hoverIndex] : null;
  const first = points[0];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Обігові кошти по днях</div>
        <div className="text-xs tabular-nums text-slate-500">
          {active
            ? `${formatDayShort(active.kyivDay)}: ${label(value(active))}${active.kyivDay === now.kyivDay ? " (зараз)" : ""}`
            : `від ${formatDayShort(first.kyivDay)}`}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-auto w-full"
        role="img"
        aria-label="Графік обігових коштів по днях"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="#eef0f4" strokeWidth="1" />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-400 text-[11px] tabular-nums">
              {compact(t)} {unit === "USD" ? "$" : "₴"}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.kyivDay} x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-400 text-[11px]">
              {formatDayShort(p.kyivDay)}
            </text>
          ) : null,
        )}
        {points.length > 1 && <path d={path} fill="none" stroke={OWN_COLOR} strokeWidth="2" strokeLinejoin="round" />}
        {active && hoverIndex != null && (
          <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={pad.top} y2={H - pad.bottom} stroke="#cbd5e1" strokeWidth="1" />
        )}
        {points.map((p, i) => (
          <circle
            key={p.kyivDay}
            cx={x(i)}
            cy={y(value(p))}
            r={hoverIndex === i || points.length === 1 ? 5 : points.length > 40 ? 0 : 3}
            fill={OWN_COLOR}
            stroke="#fff"
            strokeWidth="2"
          />
        ))}
      </svg>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">
        {points.length < 2
          ? "Графік почнеться з першого вечірнього знімка: щодня о ~23:00 фіксуємо суму. Зараз — лише поточна точка."
          : "Обігові кошти мають іти рівною лінією; змінюються від доінвестицій у товар або від вилучення коштів."}
        {unit === "UAH" ? " У гривні кожен день — за курсом того дня." : ""}
      </p>
    </section>
  );
}

/** Короткий підпис осі: 4 млн, 250 тис. */
function compact(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1).replace(".", ",")} млн`;
  }
  if (value >= 1_000) return `${formatInt(value / 1_000)} тис`;
  return formatInt(value);
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const n = raw / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * power;
}
