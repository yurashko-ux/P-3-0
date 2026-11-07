"use client";

import { useEffect, useMemo, useState } from "react";
import { PrettySelect } from "./PrettySelect";

export type CashDocumentType = "income" | "expense" | "transfer";

type AccountOpt = { id: number; title: string };
type PurposeOpt = {
  id: string;
  title: string;
  externalId: number | null;
  source?: string | null;
  groupId?: string | null;
};
type ExpenseGroup = { id: string; title: string };

/** Статті доходу. Altegio не віддає тип статті, тому ділимо за назвою; решта — витрати. */
const INCOME_PURPOSES = new Set([
  "надання послуг",
  "продаж товарів",
  "інші доходи",
  "поповнення рахунку",
  "чайові",
  "gift card sales",
  "membership sales",
  "penalty charge",
]);
/** Можуть бути і доходом, і витратою — показуємо в обох списках. */
const BOTH_PURPOSES = new Set(["повернення", "балансування рахунку"]);

/** Статті Altegio без групи в базі: до якої групи фінзвіту належать за назвою. Решта — «Інше». */
const EXPENSE_GROUPS: Array<{ title: string; items: string[] }> = [
  { title: "Зарплата", items: ["зарплата співробітникам"] },
  { title: "Оренда", items: ["оренда"] },
  {
    title: "Маркетинг",
    items: ["маркетинг cmm", "таргет оплата роботи маркетологів", "реклама, бюджет, фб", "дірект"],
  },
  {
    title: "Господарські розходи",
    items: [
      "інші витрати",
      "ремонт обладнання, інструментів",
      "доставка товарів ( нова пошта)",
      "доставка товарів (нова пошта)",
      "закупівля матеріалів",
      "канцелярські, миючі товари та засоби",
      "прибирання салону",
      "продукти для гостей",
      "комісійні % за продаж волосся",
      "комісія за еквайринг",
      "термінал",
      "інтернет, crm, ip і т. д.",
    ],
  },
  { title: "Бухгалтерія, податки", items: ["бухгалтерія", "податки та збори"] },
  { title: "Управління та інвестиції", items: ["управління", "закупівля товарів", "інвестиції в салон"] },
];

function groupPurposes(
  type: CashDocumentType,
  purposes: PurposeOpt[],
  groups: ExpenseGroup[],
): Array<{ id: string; title: string; items: PurposeOpt[] }> {
  if (type !== "expense") return [{ id: "", title: "", items: purposes }];
  const byTitle = new Map(EXPENSE_GROUPS.map((group) => [group.title, group.items]));
  const used = new Set<string>();
  const result = groups.map((group) => {
    const defaults = byTitle.get(group.title) || [];
    const items = purposes.filter((purpose) =>
      purpose.groupId ? purpose.groupId === group.id : defaults.includes(purpose.title.trim().toLowerCase()),
    );
    for (const item of items) used.add(item.id);
    return { id: group.id, title: group.title, items };
  });
  const rest = purposes.filter((purpose) => !used.has(purpose.id));
  if (rest.length > 0) result.push({ id: "other", title: "Інше", items: rest });
  return result;
}

/** Статті для приходу чи розходу: каталог Altegio і статті Креско, без переміщень та інкасації. */
function purposesFor(type: CashDocumentType, purposes: PurposeOpt[]): PurposeOpt[] {
  return purposes
    .filter((purpose) => {
      // Статті Креско знають свій вид
      if (purpose.source === "kresco_income") return type === "income";
      if (purpose.source === "kresco_expense") return type === "expense";
      return purpose.source === "altegio_expense_category";
    })
    .filter((purpose) => !/переміщ|інкас/i.test(purpose.title))
    .filter((purpose) => {
      if (purpose.source === "kresco_income" || purpose.source === "kresco_expense") return true;
      const key = purpose.title.trim().toLowerCase();
      if (BOTH_PURPOSES.has(key)) return true;
      return type === "income" ? INCOME_PURPOSES.has(key) : !INCOME_PURPOSES.has(key);
    })
    .sort((a, b) => a.title.localeCompare(b.title, "uk"));
}

/** Ті самі кольори, що в секторах плитки дій. */
const TYPE_TINT: Record<CashDocumentType, string> = {
  income: "#e5f2e9",
  expense: "#f8ebe8",
  transfer: "#e6eef8",
};

const rowClass = "grid grid-cols-[150px_1fr] items-center gap-2";
const labelClass = "text-xs text-gray-600";
const fieldClass =
  "h-8 w-full max-w-[200px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] focus:border-blue-300 focus:outline-none";

/** Коментар — завширшки як списки статей. */
const purposeInputClass =
  "h-8 w-full max-w-[260px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] focus:border-blue-300 focus:outline-none";

const headerButtonClass =
  "rounded-lg border border-slate-300/80 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-gray-700 shadow-sm hover:bg-white";
const inlineInputClass =
  "h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs focus:border-blue-300 focus:outline-none";
const inlineAddClass =
  "h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs hover:bg-slate-100 disabled:opacity-60";
const inlineCloseClass = "h-8 rounded-lg px-2 text-xs text-gray-500 hover:bg-slate-100";

const TYPE_LABEL: Record<CashDocumentType, string> = {
  income: "Прихід",
  expense: "Розхід",
  transfer: "Переміщення",
};

/** Валюта рахунку за назвою (так само, як у касі). */
function accountCurrency(title: string | undefined): "UAH" | "USD" | "EUR" {
  const text = (title || "").toLowerCase();
  if (/долар|usd|dollar/.test(text)) return "USD";
  if (/євро|евро|euro|eur|€/.test(text)) return "EUR";
  return "UAH";
}

function currencyUnit(currency: "UAH" | "USD" | "EUR"): string {
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return "грн";
}

function todayLocalInput(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Лише дата: сьогодні — поточний час, інший день — полудень, щоб день не зсунувся. */
function occurredAtFromDate(day: string): string | null {
  if (!day) return null;
  if (day === todayLocalInput()) return new Date().toISOString();
  return new Date(`${day}T12:00`).toISOString();
}

/** Ручний прихід / розхід / переміщення. Документ живе лише в Креско, в Altegio не йде. */
export function CashDocumentModal({
  type,
  onClose,
  onSaved,
}: {
  type: CashDocumentType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [purposes, setPurposes] = useState<PurposeOpt[]>([]);
  const [amount, setAmount] = useState("");
  const [counterAmount, setCounterAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [counterAccountId, setCounterAccountId] = useState("");
  const [purposeId, setPurposeId] = useState("");
  /** null — поле нової статті закрите */
  const [newPurpose, setNewPurpose] = useState<string | null>(null);
  const [newPurposeGroupId, setNewPurposeGroupId] = useState("");
  const [expenseGroups, setExpenseGroups] = useState<ExpenseGroup[]>([]);
  /** null — поле нової групи закрите */
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [occurredAt, setOccurredAt] = useState(todayLocalInput);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/finance/documents?options=1&limit=1", { credentials: "include" });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося завантажити рахунки");
        if (cancelled) return;
        setAccounts((json.accounts || []) as AccountOpt[]);
        setPurposes((json.purposes || []) as PurposeOpt[]);
        setExpenseGroups((json.expenseGroups || []) as ExpenseGroup[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Помилка завантаження");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const purposeOptions = useMemo(() => purposesFor(type, purposes), [type, purposes]);
  const purposeGroups = useMemo(
    () => groupPurposes(type, purposeOptions, expenseGroups),
    [type, purposeOptions, expenseGroups],
  );
  const currency = accountCurrency(accounts.find((account) => String(account.id) === accountId)?.title);
  const counterCurrency = accountCurrency(accounts.find((account) => String(account.id) === counterAccountId)?.title);
  const exchange = type === "transfer" && Boolean(counterAccountId) && currency !== counterCurrency;
  async function addPurpose() {
    const title = (newPurpose || "").trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/purposes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          kind: type === "income" ? "income" : "expense",
          groupId: type === "expense" ? newPurposeGroupId : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося створити статтю");
      const created = json.purpose as PurposeOpt;
      setPurposes((prev) => [...prev.filter((purpose) => purpose.id !== created.id), created]);
      setPurposeId(created.id);
      setNewPurpose(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка створення статті");
    } finally {
      setBusy(false);
    }
  }

  async function addGroup() {
    const title = (newGroup || "").trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/expense-groups", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося створити групу");
      const created = json.group as ExpenseGroup;
      setExpenseGroups((prev) => [...prev.filter((group) => group.id !== created.id), created]);
      setNewGroup(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка створення групи");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        type,
        amount: Number(amount.replace(",", ".")),
        accountId: Number(accountId),
        comment: comment || null,
        occurredAt: occurredAtFromDate(occurredAt),
      };
      if (type === "transfer") {
        payload.counterAccountId = Number(counterAccountId);
        if (exchange) payload.counterAmount = Number(counterAmount.replace(",", "."));
      } else {
        payload.purposeId = purposeId || null;
      }
      const res = await fetch("/api/admin/finance/documents", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не створено");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setBusy(false);
    }
  }

  const accountSelect = (value: string, onChange: (value: string) => void, excludeId?: string) => (
    <PrettySelect
      className="max-w-[200px]"
      value={value}
      onChange={onChange}
      options={accounts
        .filter((account) => String(account.id) !== excludeId)
        .map((account) => ({ value: String(account.id), label: account.title }))}
    />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05),0_18px_40px_-12px_rgba(15,23,42,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка в кольорі сектора плитки дій */}
        <div
          className="flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-gray-900"
          style={{ background: TYPE_TINT[type] }}
        >
          <span>{TYPE_LABEL[type]}</span>
          <div className="flex gap-1.5">
            {type === "expense" ? (
              <button
                type="button"
                className={headerButtonClass}
                onClick={() => setNewGroup((value) => (value == null ? "" : value))}
              >
                + Група
              </button>
            ) : null}
            {type !== "transfer" ? (
              <button
                type="button"
                className={headerButtonClass}
                onClick={() => setNewPurpose((value) => (value == null ? "" : value))}
              >
                + Стаття
              </button>
            ) : null}
          </div>
        </div>
        {/* Довгий список статей гортається всередині картки, шапка лишається на місці */}
        <div className="space-y-3 overflow-y-auto px-4 py-3">
          {error && <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">{error}</div>}
          {/* Основне: сума, рахунок, дата — окремим відтіненим блоком */}
          <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3">
            <div className={rowClass}>
              <span className={labelClass}>Сума, {currencyUnit(currency)}</span>
              <input
                className={fieldClass}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoFocus
              />
            </div>
            <div className={rowClass}>
              <span className={labelClass}>{type === "transfer" ? "З рахунку" : "Рахунок"}</span>
              {accountSelect(accountId, setAccountId)}
            </div>
            {type === "transfer" ? (
              <>
                <div className={rowClass}>
                  <span className={labelClass}>На рахунок</span>
                  {accountSelect(counterAccountId, setCounterAccountId, accountId)}
                </div>
                {exchange ? (
                  <div className={rowClass}>
                    <span className={labelClass}>Зайшло, {currencyUnit(counterCurrency)}</span>
                    <input
                      className={fieldClass}
                      value={counterAmount}
                      onChange={(e) => setCounterAmount(e.target.value)}
                      inputMode="decimal"
                    />
                  </div>
                ) : null}
              </>
            ) : null}
            <div className={rowClass}>
              <span className={labelClass}>Дата</span>
              <input
                type="date"
                className={fieldClass}
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </div>
          </div>
          {type !== "transfer" ? (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {type === "income" ? "Стаття доходу" : "Стаття розходу"}
              </div>
              {/* Група зліва, її статті — випадаючим списком праворуч. Обрати можна одну статтю. */}
              {purposeGroups.map((group) => {
                const selectedInGroup = group.items.some((purpose) => purpose.id === purposeId);
                return (
                  <div key={group.id || "all"} className={rowClass}>
                    <span className={`${labelClass} leading-tight`}>{group.title || "Стаття"}</span>
                    <PrettySelect
                      className="max-w-[260px]"
                      tint={TYPE_TINT[type]}
                      active={selectedInGroup}
                      value={selectedInGroup ? purposeId : ""}
                      onChange={setPurposeId}
                      options={group.items.map((purpose) => ({ value: purpose.id, label: purpose.title }))}
                    />
                  </div>
                );
              })}
              {newGroup == null ? null : (
                <div className={rowClass}>
                  <span className={labelClass}>Нова група</span>
                  <div className="flex max-w-[260px] gap-1">
                    <input
                      className={inlineInputClass}
                      placeholder="Назва групи розходу"
                      value={newGroup}
                      autoFocus
                      onChange={(e) => setNewGroup(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void addGroup();
                        }
                        if (e.key === "Escape") setNewGroup(null);
                      }}
                    />
                    <button
                      type="button"
                      className={inlineAddClass}
                      disabled={busy || !newGroup.trim()}
                      onClick={() => void addGroup()}
                    >
                      Додати
                    </button>
                    <button type="button" className={inlineCloseClass} onClick={() => setNewGroup(null)}>
                      ✕
                    </button>
                  </div>
                </div>
              )}
              {newPurpose == null ? null : (
                <div className="space-y-1.5 rounded-xl border border-dashed border-slate-300 p-2">
                  {type === "expense" ? (
                    <div className={rowClass}>
                      <span className={labelClass}>Група нової статті</span>
                      <PrettySelect
                        className="max-w-[260px]"
                        tint={TYPE_TINT[type]}
                        value={newPurposeGroupId}
                        onChange={setNewPurposeGroupId}
                        options={expenseGroups.map((group) => ({ value: group.id, label: group.title }))}
                      />
                    </div>
                  ) : null}
                  <div className={rowClass}>
                    <span className={labelClass}>Нова стаття</span>
                    <div className="flex max-w-[260px] gap-1">
                      <input
                        className={inlineInputClass}
                        placeholder={type === "income" ? "Назва статті доходу" : "Назва статті розходу"}
                        value={newPurpose}
                        autoFocus
                        onChange={(e) => setNewPurpose(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void addPurpose();
                          }
                          if (e.key === "Escape") setNewPurpose(null);
                        }}
                      />
                      <button
                        type="button"
                        className={inlineAddClass}
                        disabled={busy || !newPurpose.trim() || (type === "expense" && !newPurposeGroupId)}
                        onClick={() => void addPurpose()}
                      >
                        Додати
                      </button>
                      <button type="button" className={inlineCloseClass} onClick={() => setNewPurpose(null)}>
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <div className={rowClass}>
            <span className={labelClass}>Коментар</span>
            <input className={purposeInputClass} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <p className="text-[10px] text-gray-500">Документ запишеться лише в Креско. В Альтеджіо він не потрапить.</p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="h-8 rounded-lg px-3 text-xs text-gray-600 hover:bg-slate-100 disabled:opacity-60"
              onClick={onClose}
              disabled={busy}
            >
              Скасувати
            </button>
            <button
              type="button"
              className="h-8 rounded-lg border border-slate-200/80 px-4 text-xs font-medium text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_4px_10px_-6px_rgba(15,23,42,0.28)] transition-[filter] hover:brightness-[0.96] disabled:opacity-60"
              style={{ background: TYPE_TINT[type] }}
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? "Запис…" : "Створити"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
