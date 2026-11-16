"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WarehouseCreateButton } from "../_components/WarehouseCreateButton";
import {
  Banner,
  DOC_TINT,
  PrettySelect,
  WarehouseModal,
  cardClass,
  fieldBaseClass,
  fieldClass,
  formRowClass,
  ghostButtonClass,
  inlineAddClass,
  labelClass,
  tableClass,
  tdClass,
  theadRowClass,
  thClass,
  tileButtonClass,
  tileGridClass,
  tintButtonClass,
  trClass,
  type WarehouseDocKind,
} from "../_components/warehouse-ui";

type Mode = "list" | WarehouseDocKind;
type Storage = { id: string; title: string };
type Group = { id: string; title: string; isHair: boolean };
type DocRow = {
  id: string;
  number: number | null;
  isSale: boolean;
  type: string;
  kind: string | null;
  status: string;
  syncStatus: string;
  syncError: string | null;
  title: string;
  kyivDay: string;
  currencyCode: string | null;
  invoiceAmount: number;
  weightMismatch: boolean;
  storageTitle: string;
};
type ProductHit = {
  id: string;
  sku: number | null;
  title: string;
  costPerUnit: number;
  groupId: string | null;
  isHair?: boolean;
};

const TYPE_LABEL: Record<string, string> = {
  intake: "Прийомка",
  write_off: "Списання",
  inventory_count: "Інвентаризація",
  transfer: "Переміщення",
};

const TYPE_COLOR: Record<string, string> = {
  sale: "text-pink-700",
  intake: "text-green-700",
  write_off: "text-red-600",
  inventory_count: "text-blue-700",
  transfer: "text-violet-700",
};

/** Плитки й вкладки вікна — у порядку роботи складу. */
const DOC_TABS: Array<{ id: WarehouseDocKind; label: string; hint: string; submit: string }> = [
  { id: "hair", label: "Прийомка волосся", hint: "кг партії → хвости в грамах", submit: "Створити прийомку" },
  { id: "goods", label: "Прийомка товару", hint: "накладна з рядками", submit: "Створити прийомку" },
  { id: "inventory", label: "Інвентаризація", hint: "надлишок і недостача", submit: "Зберегти інвентаризацію" },
  { id: "write_off", label: "Списання", hint: "зі складу", submit: "Створити списання" },
  { id: "transfer", label: "Переміщення", hint: "між складами", submit: "Перемістити" },
];

/** Плитки над списком: одна «Прийомка» (товар або волосся — перемикач у вікні) і фільтр «Продано». */
type TileId = "intake" | "inventory" | "write_off" | "transfer" | "sold";
const TILES: Array<{ id: TileId; label: string; hint: string; tint: string }> = [
  { id: "intake", label: "+ Прийомка", hint: "товар або волосся", tint: DOC_TINT.goods },
  { id: "inventory", label: "+ Інвентаризація", hint: "надлишок і недостача", tint: DOC_TINT.inventory },
  { id: "write_off", label: "+ Списання", hint: "зі складу", tint: DOC_TINT.write_off },
  { id: "transfer", label: "+ Переміщення", hint: "між складами", tint: DOC_TINT.transfer },
  { id: "sold", label: "Продано", hint: "продажі в записах журналу", tint: "#fbe7f0" },
];

const DOC_ENDPOINT: Record<WarehouseDocKind, { url: string; notice: string }> = {
  hair: { url: "/api/admin/warehouse/documents/hair", notice: "Прийомку волосся створено. Залишки зміняться після проведення." },
  goods: { url: "/api/admin/warehouse/documents/goods", notice: "Прийомку товару створено. Залишки зміняться після проведення." },
  inventory: {
    url: "/api/admin/warehouse/documents/inventory",
    notice: "Інвентаризацію збережено. Автоприйомка/автосписання створені за різницями.",
  },
  write_off: { url: "/api/admin/warehouse/documents/write-off", notice: "Списання створено. Залишки зміняться після проведення." },
  transfer: { url: "/api/admin/warehouse/documents/transfer", notice: "Переміщення проведено в Kresco і Altegio." },
};

const FORM_ID = "warehouse-doc-form";

function formatAmount(value: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(value);
}

/** Статус документа — кольорова крапка біля типу, назва в підказці при наведенні. */
function docStatus(row: { status: string; syncStatus: string; syncError?: string | null }): { dot: string; label: string } {
  if (row.syncStatus === "error" || row.status === "sync_error") {
    return { dot: "bg-red-500", label: `Помилка Altegio${row.syncError ? `: ${row.syncError}` : ""}` };
  }
  if (row.syncStatus === "synced") return { dot: "bg-green-500", label: "Проведено в Kresco і Altegio" };
  if (row.syncStatus === "local") return { dot: "bg-gray-400", label: "Лише Kresco (списання з каси запису)" };
  if (row.status === "draft") return { dot: "bg-amber-400", label: "Не проведено — залишки не змінено" };
  if (row.status === "pending") return { dot: "bg-blue-400", label: "Проводиться…" };
  return { dot: "bg-gray-400", label: row.status };
}

function shortDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ymd;
}

export default function WarehouseDocumentsPage() {
  const [mode, setMode] = useState<Mode>("list");
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [storages, setStorages] = useState<Storage[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [currencies, setCurrencies] = useState<string[]>(["UAH", "USD"]);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  // Право «Склад: проводити списання» — створити списання може кожен, провести — лише з цим правом
  const [canWriteOff, setCanWriteOff] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [soldOnly, setSoldOnly] = useState(false);
  // Кошик — суперадмін або право «Склад: видаляти документи»
  const [canDelete, setCanDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DocRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Остання вибрана прийомка — вкладка «Прийомка» відкриває її
  const [intakeKind, setIntakeKind] = useState<"goods" | "hair">("goods");

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((me) => {
        const superadmin = me?.user?.type === "superadmin";
        setCanDelete(superadmin || me?.permissions?.warehouseDeleteDocs === "edit");
        setCanWriteOff(superadmin || me?.permissions?.warehouseWriteOff === "edit");
      })
      .catch(() => setCanWriteOff(false));
  }, []);

  const loadMeta = useCallback(async () => {
    const [wh, cur, fx, list] = await Promise.all([
      fetch("/api/admin/warehouse", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/admin/warehouse/currencies", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/admin/warehouse/fx", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/admin/warehouse/documents", { credentials: "include", cache: "no-store" }).then((r) => r.json()),
    ]);
    if (wh.ok) {
      setStorages(wh.storages || []);
      setGroups(wh.groups || []);
    }
    if (cur.ok) {
      setCurrencies((cur.enabled || []).filter((r: { enabled: boolean }) => r.enabled).map((r: { code: string }) => r.code));
    }
    if (fx.ok) setFxRate(fx.rate);
    if (list.ok) setDocs(list.documents || []);
  }, []);

  useEffect(() => {
    void loadMeta()
      .catch((err) => setError(err instanceof Error ? err.message : "Помилка"))
      .finally(() => setLoading(false));
  }, [loadMeta]);

  const addStorage = (row: { id: string; title: string }) =>
    setStorages((prev) => (prev.some((s) => s.id === row.id) ? prev : [...prev, row]));
  const addGroup = (row: { id: string; title: string; isHair?: boolean }) =>
    setGroups((prev) =>
      prev.some((g) => g.id === row.id) ? prev : [...prev, { id: row.id, title: row.title, isHair: Boolean(row.isHair) }],
    );

  const submitDocument = async (kind: WarehouseDocKind, payload: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(DOC_ENDPOINT[kind].url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка");
      setNotice(DOC_ENDPOINT[kind].notice);
      setMode("list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
      // Документ з помилкою Altegio теж збережено — показуємо його в списку одразу.
      void loadMeta().catch(() => undefined);
    }
  };

  const deleteDocument = async (row: DocRow) => {
    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/warehouse/documents?id=${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка видалення");
      const altegioNote =
        json.document?.altegio === "deleted"
          ? " в Kresco і Altegio"
          : json.document?.altegio === "already_gone"
            ? " в Kresco (в Altegio його вже не було)"
            : " (в Altegio його не було)";
      setNotice(`Документ «${row.title}» видалено${altegioNote}. Залишки оновляться при наступній синхронізації з Altegio.`);
      setDeleteTarget(null);
      await loadMeta();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  // Продажі не змішуємо з документами складу — вони лише за плиткою «Продано»
  const visibleDocs = useMemo(() => docs.filter((row) => row.isSale === soldOnly), [docs, soldOnly]);
  const soldCount = useMemo(() => docs.filter((row) => row.isSale).length, [docs]);

  const postDocument = async (row: DocRow) => {
    setPostingId(row.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/warehouse/documents/${encodeURIComponent(row.id)}/post`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка проведення");
      setNotice(`Документ «${row.title}» проведено: залишки змінено, записано в Altegio.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setPostingId(null);
      void loadMeta().catch(() => undefined);
    }
  };
  // Провести можна чернетку або документ з помилкою Altegio; списання — лише з правом списання
  const canPost = (row: DocRow) =>
    !row.isSale &&
    (row.status === "draft" || row.status === "sync_error") &&
    (row.type === "intake" || row.type === "transfer" || (row.type === "write_off" && canWriteOff));
  const showPostColumn = visibleDocs.some(canPost);

  const tiles = TILES;
  const activeTab = DOC_TABS.find((tab) => tab.id === mode);
  // Вкладки вікна: дві прийомки — одна вкладка з перемикачем «Товар / Волосся»
  const modalTabs = [
    { id: "intake", label: "Прийомка" },
    ...DOC_TABS.filter((tab) => tab.id !== "hair" && tab.id !== "goods").map(
      (tab) => ({ id: tab.id, label: tab.label }),
    ),
  ];
  const openTab = (id: string) => {
    setError(null);
    setMode(id === "intake" ? intakeKind : (id as WarehouseDocKind));
  };

  return (
    <main className="px-2 pb-6 space-y-2">
      {/* Плитки типів документів — як «+ Рахунок» у Касі */}
      <div className={`${tileGridClass} py-2`}>
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className={`${tileButtonClass} ${tile.id === "sold" && soldOnly ? "ring-2 ring-pink-400" : ""}`}
            style={{ background: tile.tint }}
            onClick={() => (tile.id === "sold" ? setSoldOnly((v) => !v) : openTab(tile.id))}
          >
            <span className="text-sm font-semibold text-gray-800">
              {tile.label}
              {tile.id === "sold" ? <span className="ml-1 tabular-nums text-pink-700">{soldCount}</span> : null}
            </span>
            <span className="text-[10px] text-gray-600">
              {tile.id === "sold" && soldOnly ? "показано продажі · натисніть, щоб повернутись" : tile.hint}
            </span>
          </button>
        ))}
      </div>

      {notice && <Banner tone="success">{notice}</Banner>}
      {error && mode === "list" && <Banner tone="error">{error}</Banner>}

      {/* Ширина таблиці — за вмістом, назва обрізається */}
      <div className={`${cardClass} w-fit max-w-full overflow-x-auto`}>
        <table className="w-auto text-left text-[10px] [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead>
            <tr className={theadRowClass}>
              <th className={`${thClass} text-right`}>№</th>
              <th className={thClass}>Дата</th>
              <th className={thClass}>Тип</th>
              <th className={thClass}>Назва</th>
              <th className={`${thClass} text-right`}>Сума</th>
              <th className={thClass}>Склад</th>
              {showPostColumn && <th className={thClass} />}
              {canDelete && <th className={thClass} />}
            </tr>
          </thead>
          <tbody>
            {visibleDocs.map((row) => {
              const status = docStatus(row);
              const typeKey = row.isSale ? "sale" : row.type;
              const href = `/admin/warehouse/documents/${row.id}`;
              return (
                <tr
                  key={row.id}
                  className={`${trClass} hover:bg-slate-50 ${row.kind === "hair" && row.weightMismatch ? "bg-pink-100" : ""}`}
                >
                  <td className={`${tdClass} text-right tabular-nums text-gray-500`}>{row.number ?? "—"}</td>
                  <td className={`${tdClass} tabular-nums text-gray-700`}>{shortDate(row.kyivDay)}</td>
                  <td className={tdClass}>
                    <Link href={href} className={`inline-flex items-center gap-1.5 font-semibold hover:underline ${TYPE_COLOR[typeKey] || "text-gray-700"}`}>
                      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${status.dot}`} title={status.label} />
                      {row.isSale ? "Продаж" : TYPE_LABEL[row.type] || row.type}
                      {row.kind === "hair" ? <span className="font-normal text-amber-700">волосся</span> : null}
                    </Link>
                  </td>
                  <td className={`${tdClass} max-w-[220px] truncate`}>
                    <Link href={href} className="text-blue-700 hover:underline">
                      {row.title}
                    </Link>
                  </td>
                  <td className={`${tdClass} text-right font-semibold tabular-nums`}>
                    {row.invoiceAmount ? `${formatAmount(row.invoiceAmount)} ${row.currencyCode || ""}` : "—"}
                  </td>
                  <td className={`${tdClass} max-w-[160px] truncate text-gray-700`}>{row.storageTitle}</td>
                  {showPostColumn && (
                    <td className={tdClass}>
                      {canPost(row) && (
                        <button
                          type="button"
                          className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-800 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                          style={{ background: row.type === "write_off" ? DOC_TINT.write_off : DOC_TINT.goods }}
                          disabled={postingId !== null}
                          title="Змінити залишки й записати документ в Altegio"
                          onClick={() => void postDocument(row)}
                        >
                          {postingId === row.id ? "Проведення…" : row.status === "sync_error" ? "Провести ще раз" : "Провести"}
                        </button>
                      )}
                    </td>
                  )}
                  {canDelete && (
                    <td className={`${tdClass} text-right`}>
                      <button
                        type="button"
                        className="rounded px-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        title="Видалити документ"
                        aria-label="Видалити документ"
                        onClick={() => setDeleteTarget(row)}
                      >
                        🗑
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && <p className="px-3 py-6 text-center text-sm text-gray-500">Завантаження…</p>}
        {!loading && !visibleDocs.length && (
          <p className="px-3 py-6 text-center text-sm text-gray-500">{soldOnly ? "Поки немає продажів." : "Поки немає документів Kresco."}</p>
        )}
      </div>

      <p className="max-w-2xl px-1 text-[10px] leading-snug text-gray-500">
        Прийомка і списання створюються чернеткою й залишків не міняють. Кнопка «Провести» змінює залишки і записує документ у
        склад Altegio; списання проводить лише той, хто має право «Склад: проводити списання». Каса й журнал запису лишаються там. Курс USD/UAH —
        денний робочий (Monobank sell → ceil+1); якщо недоступний — fallback на блок 4 фінзвіту. При продажі/списанні волосся
        собівартість береться з картки (costUsd + costPerUnit у грн на момент закупки), без перерахунку по новому курсу.
      </p>

      {deleteTarget && (
        <WarehouseModal
          tint={DOC_TINT.write_off}
          title="Видалити документ?"
          onClose={() => (deleting ? undefined : setDeleteTarget(null))}
          footer={
            <>
              <button type="button" className={ghostButtonClass} disabled={deleting} onClick={() => setDeleteTarget(null)}>
                Скасувати
              </button>
              <button
                type="button"
                className="h-8 rounded-lg bg-red-600 px-4 text-xs font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
                disabled={deleting}
                onClick={() => void deleteDocument(deleteTarget)}
              >
                {deleting ? "Видалення…" : "Видалити"}
              </button>
            </>
          }
        >
          <p className="text-xs text-gray-900">
            {deleteTarget.number ? `№ ${deleteTarget.number} · ` : ""}
            {shortDate(deleteTarget.kyivDay)} ·{" "}
            <span className="font-semibold">{deleteTarget.isSale ? "Продаж" : TYPE_LABEL[deleteTarget.type] || deleteTarget.type}</span> ·{" "}
            {deleteTarget.title}
          </p>
          <p className="text-xs text-gray-600">
            Документ буде видалено назавжди в Kresco і в Altegio (якщо він туди записаний) — залишок повернеться. Якщо
            Altegio відмовить, нічого не видаляється.
          </p>
        </WarehouseModal>
      )}

      {activeTab && (
        <WarehouseModal
          tint={DOC_TINT[activeTab.id]}
          tabs={modalTabs}
          activeTab={mode === "hair" || mode === "goods" ? "intake" : activeTab.id}
          onTab={openTab}
          onClose={() => setMode("list")}
          wide
          fixedHeight
          footer={
            <>
              <button type="button" className={ghostButtonClass} onClick={() => setMode("list")}>
                Скасувати
              </button>
              <button
                type="submit"
                form={FORM_ID}
                className={tintButtonClass()}
                style={{ background: DOC_TINT[activeTab.id] }}
                disabled={saving}
              >
                {saving ? "Збереження…" : activeTab.submit}
              </button>
            </>
          }
        >
          {error && <Banner tone="error">{error}</Banner>}
          {(mode === "hair" || mode === "goods") && (
            <div className="flex w-fit gap-1 rounded-xl bg-slate-100 p-0.5">
              {(
                [
                  { id: "goods", label: "Товар" },
                  { id: "hair", label: "Волосся · кг партії → хвости в грамах" },
                ] as const
              ).map((kind) => (
                <button
                  key={kind.id}
                  type="button"
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                    mode === kind.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                  }`}
                  onClick={() => {
                    setError(null);
                    setIntakeKind(kind.id);
                    setMode(kind.id);
                  }}
                >
                  {kind.label}
                </button>
              ))}
            </div>
          )}
          {mode === "hair" && (
            <HairForm
              storages={storages}
              groups={groups}
              fxRate={fxRate}
              currencies={currencies}
              onAddStorage={addStorage}
              onAddGroup={addGroup}
              onSubmit={(payload) => submitDocument("hair", payload)}
            />
          )}
          {mode === "goods" && (
            <GoodsForm
              storages={storages}
              groups={groups}
              currencies={currencies}
              onAddStorage={addStorage}
              onAddGroup={addGroup}
              onSubmit={(payload) => submitDocument("goods", payload)}
            />
          )}
          {mode === "inventory" && (
            <InventoryForm
              storages={storages}
              groups={groups}
              onAddStorage={addStorage}
              onAddGroup={addGroup}
              onSubmit={(payload) => submitDocument("inventory", payload)}
            />
          )}
          {mode === "write_off" && (
            <WriteOffForm storages={storages} onAddStorage={addStorage} onSubmit={(payload) => submitDocument("write_off", payload)} />
          )}
          {mode === "transfer" && (
            <TransferForm storages={storages} onAddStorage={addStorage} onSubmit={(payload) => submitDocument("transfer", payload)} />
          )}
        </WarehouseModal>
      )}
    </main>
  );
}

/** Блок полів шапки документа — як сіра картка полів у вікні Каси. */
function FieldsCard({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3">{children}</div>;
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={formRowClass}>
      <span className={labelClass}>{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{children}</div>;
}

function StorageSelect({
  storages,
  value,
  onChange,
  onAddStorage,
  tint,
}: {
  storages: Storage[];
  value: string;
  onChange: (id: string) => void;
  onAddStorage: (row: { id: string; title: string }) => void;
  tint: string;
}) {
  return (
    <>
      <div className="min-w-0 max-w-[260px] flex-1">
        <PrettySelect
          value={value}
          tint={tint}
          options={storages.map((s) => ({ value: s.id, label: s.title }))}
          onChange={onChange}
        />
      </div>
      <WarehouseCreateButton
        kind="storage"
        onCreated={(row) => {
          onAddStorage(row);
          onChange(row.id);
        }}
      />
    </>
  );
}

function HairForm({
  storages,
  groups,
  fxRate,
  currencies,
  onSubmit,
  onAddStorage,
  onAddGroup,
}: {
  storages: Storage[];
  groups: Group[];
  fxRate: number | null;
  currencies: string[];
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onAddStorage: (row: { id: string; title: string }) => void;
  onAddGroup: (row: { id: string; title: string; isHair?: boolean }) => void;
}) {
  const tint = DOC_TINT.hair;
  const hairOnly = groups.filter((g) => g.isHair);
  // Якщо ознаки «волосся» в групах немає — показуємо всі, першими «Хвости».
  const hairGroups = hairOnly.length
    ? hairOnly
    : [...groups].sort((a, b) => Number(b.title === "Хвости") - Number(a.title === "Хвости"));
  const hairCurrencies = currencies.includes("USD")
    ? ["USD", ...currencies.filter((c) => c !== "USD")]
    : currencies.length
      ? currencies
      : ["USD"];
  const [storageId, setStorageId] = useState(storages[0]?.id || "");
  const [groupId, setGroupId] = useState(hairGroups[0]?.id || "");
  const [title, setTitle] = useState("");
  const [kg, setKg] = useState("10");
  const [currencyCode, setCurrencyCode] = useState(hairCurrencies[0] || "USD");
  const [invoice, setInvoice] = useState("26000");
  const [delivery, setDelivery] = useState("0");
  const [lines, setLines] = useState<Array<{ lengthCm: string; weightGrams: string }>>([{ lengthCm: "60", weightGrams: "" }]);

  useEffect(() => {
    if (!storageId && storages[0]) setStorageId(storages[0].id);
  }, [storages, storageId]);
  useEffect(() => {
    if (!groupId && hairGroups[0]) setGroupId(hairGroups[0].id);
  }, [hairGroups, groupId]);

  const invoiceG = (Number(kg) || 0) * 1000;
  const sumG = lines.reduce((acc, line) => acc + (Number(line.weightGrams) || 0), 0);
  const delta = Math.round((sumG - invoiceG) * 100) / 100;
  const mismatch = Math.abs(delta) > 50;
  const perG = invoiceG > 0 ? (Number(invoice) + Number(delivery || 0)) / invoiceG : 0;
  const curLabel = currencyCode === "USD" ? "$" : currencyCode;

  return (
    <form
      id={FORM_ID}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          storageId,
          groupId,
          title,
          weightKg: Number(kg),
          currencyCode,
          invoiceAmountUsd:
            currencyCode === "UAH" && fxRate && fxRate > 0
              ? Number(invoice) / fxRate
              : Number(invoice),
          deliveryAmountUsd:
            currencyCode === "UAH" && fxRate && fxRate > 0
              ? (Number(delivery) || 0) / fxRate
              : Number(delivery) || 0,
          lines: lines
            .map((line) => ({ lengthCm: Number(line.lengthCm), weightGrams: Number(line.weightGrams) }))
            .filter((line) => line.weightGrams > 0),
        });
      }}
    >
      <FieldsCard>
        <FieldRow label="Склад">
          <StorageSelect storages={storages} value={storageId} onChange={setStorageId} onAddStorage={onAddStorage} tint={tint} />
        </FieldRow>
        <FieldRow label="Група">
          <div className="min-w-0 max-w-[260px] flex-1">
            <PrettySelect
              value={groupId}
              tint={tint}
              options={hairGroups.map((g) => ({ value: g.id, label: g.title }))}
              onChange={setGroupId}
            />
          </div>
          <WarehouseCreateButton
            kind="group"
            onCreated={(row) => {
              onAddGroup(row);
              setGroupId(row.id);
            }}
          />
        </FieldRow>
        <FieldRow label="Назва (два слова)">
          <input className={`${fieldClass} max-w-[260px]`} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </FieldRow>
        <FieldRow label="Вага партії, кг">
          <input className={`${fieldClass} max-w-[120px] tabular-nums`} value={kg} onChange={(e) => setKg(e.target.value)} required />
        </FieldRow>
        <FieldRow label={`Сума накладної, ${curLabel}`}>
          <input
            className={`${fieldClass} max-w-[140px] tabular-nums`}
            value={invoice}
            onChange={(e) => setInvoice(e.target.value)}
            required
          />
          <div className="w-[90px]">
            <PrettySelect
              value={currencyCode}
              tint={tint}
              options={hairCurrencies.map((c) => ({ value: c, label: c }))}
              onChange={setCurrencyCode}
            />
          </div>
        </FieldRow>
        <FieldRow label={`Доставка, ${curLabel}`}>
          <input
            className={`${fieldClass} max-w-[140px] tabular-nums`}
            placeholder="опційно"
            value={delivery}
            onChange={(e) => setDelivery(e.target.value)}
          />
        </FieldRow>
      </FieldsCard>

      <p className={`rounded-lg px-2.5 py-1.5 text-xs ${mismatch ? "bg-pink-100 font-semibold text-red-700" : "bg-slate-50 text-gray-600"}`}>
        У накладній {invoiceG} г, по хвостах {sumG} г, дельта {delta} г (допуск ±50). 1 г ≈ {perG ? perG.toFixed(4) : "—"} {curLabel}
        <span className="block text-[10px] font-normal text-gray-500">
          Курс USD/UAH (денний): {fxRate ? fxRate : "відсутній — проведення буде зупинено"}. Собівартість 1 г = (накладна + доставка) /
          (кг×1000).
        </span>
      </p>

      <div className="space-y-1.5">
        <SectionTitle>Хвости</SectionTitle>
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className={tableClass}>
            <thead>
              <tr className={theadRowClass}>
                <th className={`${thClass} w-10`}>№</th>
                <th className={thClass}>Довжина, см</th>
                <th className={thClass}>Вага, г</th>
                <th className={`${thClass} text-right`}>Собівартість</th>
                <th className={`${thClass} w-8`} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx} className={trClass}>
                  <td className={`${tdClass} tabular-nums text-gray-500`}>{idx + 1}</td>
                  <td className={tdClass}>
                    <input
                      className={`${fieldClass} h-7 max-w-[100px] tabular-nums`}
                      value={line.lengthCm}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx] = { ...next[idx], lengthCm: e.target.value };
                        setLines(next);
                      }}
                    />
                  </td>
                  <td className={tdClass}>
                    <input
                      className={`${fieldClass} h-7 max-w-[100px] tabular-nums`}
                      placeholder="грами"
                      value={line.weightGrams}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx] = { ...next[idx], weightGrams: e.target.value };
                        setLines(next);
                      }}
                    />
                  </td>
                  <td className={`${tdClass} text-right font-semibold tabular-nums`}>
                    {Number(line.weightGrams) > 0 && perG > 0 ? `${(perG * Number(line.weightGrams)).toFixed(2)} ${curLabel}` : "—"}
                  </td>
                  <td className={tdClass}>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="text-gray-400 hover:text-red-600"
                        aria-label="Прибрати хвіст"
                        onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className={inlineAddClass} onClick={() => setLines([...lines, { lengthCm: "60", weightGrams: "" }])}>
          + хвіст
        </button>
      </div>
    </form>
  );
}

function ProductSearch({ onPick }: { onPick: (p: ProductHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  useEffect(() => {
    if (q.trim().length < 1) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/admin/warehouse/catalog?search=${encodeURIComponent(q)}`, { credentials: "include" })
        .then((r) => r.json())
        .then((json) => setHits(json.products || []));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <input className={fieldClass} placeholder="Код або назва товару…" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <div className="mt-1 max-h-48 overflow-auto rounded-xl border border-slate-200/80 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_12px_28px_-10px_rgba(15,23,42,0.35)]">
          {hits.slice(0, 12).map((p) => (
            <button
              key={p.id}
              type="button"
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-gray-800 hover:bg-slate-50"
              onClick={() => {
                onPick(p);
                setQ("");
                setHits([]);
              }}
            >
              <span className="tabular-nums text-gray-500">{p.sku}</span> · {p.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GoodsForm({
  storages,
  groups,
  currencies,
  onSubmit,
  onAddStorage,
  onAddGroup,
}: {
  storages: Storage[];
  groups: Group[];
  currencies: string[];
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onAddStorage: (row: { id: string; title: string }) => void;
  onAddGroup: (row: { id: string; title: string; isHair?: boolean }) => void;
}) {
  const tint = DOC_TINT.goods;
  const defaultCur = currencies.includes("UAH") ? "UAH" : currencies[0] || "UAH";
  const [storageId, setStorageId] = useState(storages[0]?.id || "");
  const [title, setTitle] = useState("");
  const [invoice, setInvoice] = useState("");
  const [delivery, setDelivery] = useState("0");
  const [lines, setLines] = useState<
    Array<{ productId: string; title: string; groupId: string; quantity: string; price: string; currencyCode: string }>
  >([{ productId: "", title: "", groupId: "", quantity: "1", price: "", currencyCode: defaultCur }]);

  const currencyForGroup = (groupId: string) => {
    const g = groups.find((x) => x.id === groupId);
    if (g?.isHair && currencies.includes("USD")) return "USD";
    return defaultCur;
  };

  const updateLine = (idx: number, patch: Partial<(typeof lines)[number]>) => {
    const next = [...lines];
    next[idx] = { ...next[idx], ...patch };
    setLines(next);
  };

  return (
    <form
      id={FORM_ID}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const primaryCurrency =
          lines.find((l) => l.currencyCode)?.currencyCode || defaultCur;
        void onSubmit({
          storageId,
          title,
          currencyCode: primaryCurrency,
          invoiceAmount: Number(invoice),
          deliveryAmount: Number(delivery) || 0,
          lines: lines.map((line) => ({
            productId: line.productId || undefined,
            title: line.title || undefined,
            groupId: line.groupId || undefined,
            quantity: Number(line.quantity),
            price: Number(line.price),
            currencyCode: line.currencyCode || defaultCur,
          })),
        });
      }}
    >
      <FieldsCard>
        <FieldRow label="Склад">
          <StorageSelect storages={storages} value={storageId} onChange={setStorageId} onAddStorage={onAddStorage} tint={tint} />
        </FieldRow>
        <FieldRow label="Назва (два слова)">
          <input className={`${fieldClass} max-w-[260px]`} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </FieldRow>
        <FieldRow label="Сума накладної">
          <input
            className={`${fieldClass} max-w-[140px] tabular-nums`}
            placeholder="без доставки"
            value={invoice}
            onChange={(e) => setInvoice(e.target.value)}
            required
          />
        </FieldRow>
        <FieldRow label="Доставка">
          <input
            className={`${fieldClass} max-w-[140px] tabular-nums`}
            placeholder="опційно"
            value={delivery}
            onChange={(e) => setDelivery(e.target.value)}
          />
        </FieldRow>
      </FieldsCard>

      <div className="space-y-1.5">
        <SectionTitle>Товари</SectionTitle>
        <p className="text-[10px] text-gray-500">
          Валюта собівартості — біля ціни в рядку. Для груп «хвости / волосся» за замовчуванням USD (денний курс).
        </p>
        {lines.map((line, idx) => (
          <div key={idx} className="space-y-2 rounded-xl border border-gray-200 bg-white p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Рядок {idx + 1}</span>
              {lines.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-gray-400 hover:text-red-600"
                  aria-label="Прибрати рядок"
                  onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                >
                  ✕
                </button>
              )}
            </div>
            <ProductSearch
              onPick={(p) => {
                const g = groups.find((x) => x.id === (p.groupId || ""));
                const hair = Boolean(p.isHair || g?.isHair);
                updateLine(idx, {
                  productId: p.id,
                  title: p.title,
                  groupId: p.groupId || line.groupId,
                  price: String(p.costPerUnit || ""),
                  currencyCode: hair && currencies.includes("USD") ? "USD" : line.currencyCode || defaultCur,
                });
              }}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                className={fieldClass}
                placeholder="Нова назва (якщо товару ще немає)"
                value={line.title}
                onChange={(e) => updateLine(idx, { title: e.target.value, productId: "" })}
              />
              <div className="flex min-w-0 gap-1.5">
                <div className="min-w-0 flex-1">
                  <PrettySelect
                    value={line.groupId}
                    tint={tint}
                    options={[
                      { value: "", label: "Група (для нової картки)" },
                      ...groups.map((g) => ({ value: g.id, label: g.title })),
                    ]}
                    onChange={(gid) => updateLine(idx, { groupId: gid, currencyCode: currencyForGroup(gid) })}
                  />
                </div>
                {idx === 0 && (
                  <WarehouseCreateButton
                    kind="group"
                    onCreated={(row) => {
                      onAddGroup(row);
                      updateLine(idx, {
                        groupId: row.id,
                        currencyCode: row.isHair && currencies.includes("USD") ? "USD" : line.currencyCode,
                      });
                    }}
                  />
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5">
                <span className={`${labelClass} whitespace-nowrap`}>К-сть</span>
                <input
                  className={`${fieldBaseClass} w-20 tabular-nums`}
                  value={line.quantity}
                  onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className={`${labelClass} whitespace-nowrap`}>Собівартість</span>
                <input
                  className={`${fieldBaseClass} w-28 tabular-nums`}
                  value={line.price}
                  onChange={(e) => updateLine(idx, { price: e.target.value })}
                />
              </label>
              <div className="w-[90px]" title="Валюта собівартості">
                <PrettySelect
                  value={line.currencyCode}
                  tint={tint}
                  options={currencies.map((c) => ({ value: c, label: c }))}
                  onChange={(code) => updateLine(idx, { currencyCode: code })}
                />
              </div>
              {line.productId ? <span className="text-[10px] text-green-700">наявна картка</span> : null}
            </div>
          </div>
        ))}
        <button
          type="button"
          className={inlineAddClass}
          onClick={() =>
            setLines([
              ...lines,
              { productId: "", title: "", groupId: "", quantity: "1", price: "", currencyCode: defaultCur },
            ])
          }
        >
          + рядок
        </button>
      </div>
    </form>
  );
}

/** Таблиця товарів документа з кількістю — для списання й переміщення. */
function QtyLinesTable({
  lines,
  onQty,
  onRemove,
}: {
  lines: Array<{ productId: string; title: string; quantity: string }>;
  onQty: (idx: number, value: string) => void;
  onRemove: (idx: number) => void;
}) {
  if (lines.length === 0) {
    return <p className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-gray-500">Додайте товар через пошук.</p>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <table className={tableClass}>
        <thead>
          <tr className={theadRowClass}>
            <th className={`${thClass} w-10`}>№</th>
            <th className={thClass}>Товар</th>
            <th className={`${thClass} w-28 text-right`}>К-сть</th>
            <th className={`${thClass} w-8`} />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => (
            <tr key={line.productId + idx} className={trClass}>
              <td className={`${tdClass} tabular-nums text-gray-500`}>{idx + 1}</td>
              <td className={`${tdClass} text-gray-900`}>{line.title}</td>
              <td className={`${tdClass} text-right`}>
                <input
                  className={`${fieldBaseClass} ml-auto h-7 w-20 text-right tabular-nums`}
                  value={line.quantity}
                  onChange={(e) => onQty(idx, e.target.value)}
                />
              </td>
              <td className={tdClass}>
                <button type="button" className="text-gray-400 hover:text-red-600" aria-label="Прибрати" onClick={() => onRemove(idx)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WriteOffForm({
  storages,
  onSubmit,
  onAddStorage,
}: {
  storages: Storage[];
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onAddStorage: (row: { id: string; title: string }) => void;
}) {
  const tint = DOC_TINT.write_off;
  const [storageId, setStorageId] = useState(storages[0]?.id || "");
  const [title, setTitle] = useState("Списання товару");
  const [lines, setLines] = useState<Array<{ productId: string; title: string; quantity: string }>>([]);

  return (
    <form
      id={FORM_ID}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          storageId,
          title,
          lines: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })),
        });
      }}
    >
      <FieldsCard>
        <FieldRow label="Склад">
          <StorageSelect storages={storages} value={storageId} onChange={setStorageId} onAddStorage={onAddStorage} tint={tint} />
        </FieldRow>
        <FieldRow label="Назва">
          <input className={`${fieldClass} max-w-[260px]`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </FieldRow>
      </FieldsCard>
      <div className="space-y-1.5">
        <SectionTitle>Товари</SectionTitle>
        <ProductSearch onPick={(p) => setLines([...lines, { productId: p.id, title: `${p.sku} ${p.title}`, quantity: "1" }])} />
        <QtyLinesTable
          lines={lines}
          onQty={(idx, value) => {
            const next = [...lines];
            next[idx] = { ...next[idx], quantity: value };
            setLines(next);
          }}
          onRemove={(idx) => setLines(lines.filter((_, i) => i !== idx))}
        />
      </div>
    </form>
  );
}

function TransferForm({
  storages,
  onSubmit,
  onAddStorage,
}: {
  storages: Storage[];
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onAddStorage: (row: { id: string; title: string }) => void;
}) {
  const tint = DOC_TINT.transfer;
  const [fromStorageId, setFromStorageId] = useState(storages[0]?.id || "");
  const [toStorageId, setToStorageId] = useState(storages.find((s) => s.id !== storages[0]?.id)?.id || "");
  const [lines, setLines] = useState<Array<{ productId: string; title: string; quantity: string }>>([]);

  const otherStorageId = (exceptId: string) => storages.find((s) => s.id !== exceptId)?.id || "";

  const addOrBump = (p: ProductHit) => {
    setLines((prev) => {
      const idx = prev.findIndex((line) => line.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: String((Number(next[idx].quantity) || 0) + 1) };
        return next;
      }
      return [...prev, { productId: p.id, title: `${p.sku ?? ""} ${p.title}`.trim(), quantity: "1" }];
    });
  };

  return (
    <form
      id={FORM_ID}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          fromStorageId,
          toStorageId,
          lines: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })),
        });
      }}
    >
      <FieldsCard>
        <FieldRow label="Звідки">
          <StorageSelect
            storages={storages}
            value={fromStorageId}
            tint={tint}
            onAddStorage={onAddStorage}
            onChange={(next) => {
              setFromStorageId(next);
              if (next === toStorageId) setToStorageId(otherStorageId(next));
            }}
          />
        </FieldRow>
        <FieldRow label="Куди">
          <StorageSelect
            storages={storages.filter((s) => s.id !== fromStorageId)}
            value={toStorageId}
            tint={tint}
            onAddStorage={onAddStorage}
            onChange={setToStorageId}
          />
        </FieldRow>
      </FieldsCard>
      <div className="space-y-1.5">
        <SectionTitle>Товари</SectionTitle>
        <p className="text-[10px] text-gray-500">Одна операція переміщення в Kresco і Altegio. Повторний вибір коду збільшує кількість.</p>
        <ProductSearch onPick={addOrBump} />
        <QtyLinesTable
          lines={lines}
          onQty={(idx, value) => {
            const next = [...lines];
            next[idx] = { ...next[idx], quantity: value };
            setLines(next);
          }}
          onRemove={(idx) => setLines(lines.filter((_, i) => i !== idx))}
        />
      </div>
    </form>
  );
}

function InventoryForm({
  storages,
  groups,
  onSubmit,
  onAddStorage,
  onAddGroup,
}: {
  storages: Storage[];
  groups: Group[];
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onAddStorage: (row: { id: string; title: string }) => void;
  onAddGroup: (row: { id: string; title: string; isHair?: boolean }) => void;
}) {
  const tint = DOC_TINT.inventory;
  const [storageId, setStorageId] = useState(storages[0]?.id || "");
  const [title, setTitle] = useState("Повна інвентаризація");
  const [groupId, setGroupId] = useState(groups[0]?.id || "");
  const [lines, setLines] = useState<Array<{ productId: string; title: string; book: number; countedQty: string }>>([]);
  const [adding, setAdding] = useState(false);

  const addGroup = async () => {
    setAdding(true);
    try {
      const params = new URLSearchParams({ includeZero: "1", groupId, storageId });
      const res = await fetch(`/api/admin/warehouse?${params}`, { credentials: "include" });
      const json = await res.json();
      const stocks = json.stocks || [];
      const catalog = await fetch(`/api/admin/warehouse/catalog?groupId=${groupId}`, { credentials: "include" }).then((r) => r.json());
      const byId = new Map<string, { title: string; book: number }>();
      for (const p of catalog.products || []) {
        byId.set(p.id, { title: `${p.sku ?? ""} ${p.title}`, book: 0 });
      }
      for (const row of stocks) {
        byId.set(row.product.id, {
          title: `${row.product.sku ?? ""} ${row.product.title}`,
          book: Number(row.quantity) || 0,
        });
      }
      setLines((prev) => {
        const seen = new Set(prev.map((l) => l.productId));
        const extra = [...byId.entries()]
          .filter(([id]) => !seen.has(id))
          .map(([id, row]) => ({ productId: id, title: row.title, book: row.book, countedQty: String(row.book) }));
        return [...prev, ...extra];
      });
    } finally {
      setAdding(false);
    }
  };

  const changed = lines.filter((line) => Number(line.countedQty) !== line.book).length;

  return (
    <form
      id={FORM_ID}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          storageId,
          title,
          lines: lines.map((line) => ({ productId: line.productId, countedQty: Number(line.countedQty) })),
        });
      }}
    >
      <FieldsCard>
        <FieldRow label="Склад">
          <StorageSelect storages={storages} value={storageId} onChange={setStorageId} onAddStorage={onAddStorage} tint={tint} />
        </FieldRow>
        <FieldRow label="Назва">
          <input className={`${fieldClass} max-w-[260px]`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </FieldRow>
        <FieldRow label="Група">
          <div className="min-w-0 max-w-[260px] flex-1">
            <PrettySelect value={groupId} tint={tint} options={groups.map((g) => ({ value: g.id, label: g.title }))} onChange={setGroupId} />
          </div>
          <WarehouseCreateButton
            kind="group"
            onCreated={(row) => {
              onAddGroup(row);
              setGroupId(row.id);
            }}
          />
          <button
            type="button"
            className={tintButtonClass()}
            style={{ background: tint }}
            disabled={adding || !groupId}
            onClick={() => void addGroup()}
          >
            {adding ? "…" : "Внести в акт"}
          </button>
        </FieldRow>
      </FieldsCard>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>Акт · позицій {lines.length}</SectionTitle>
          {changed > 0 ? <span className="text-[10px] font-medium text-amber-700">змінено: {changed}</span> : null}
        </div>
        <p className="text-[10px] text-gray-500">
          Додавайте групи по черзі (фарби, хвости…). За різницею факту й обліку система створить прийомку і/або списання — і запише
          їх у Altegio.
        </p>
        {lines.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-gray-500">
            Оберіть групу і натисніть «Внести в акт».
          </p>
        ) : (
          <div className="max-h-[45vh] overflow-auto rounded-xl border border-gray-200">
            <table className={tableClass}>
              <thead className="sticky top-0">
                <tr className={theadRowClass}>
                  <th className={`${thClass} bg-gray-50`}>Товар</th>
                  <th className={`${thClass} w-20 bg-gray-50 text-right`}>Облік</th>
                  <th className={`${thClass} w-28 bg-gray-50 text-right`}>Факт</th>
                  <th className={`${thClass} w-20 bg-gray-50 text-right`}>Різниця</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => {
                  const counted = Number(line.countedQty);
                  const diff = Number.isFinite(counted) ? Math.round((counted - line.book) * 10000) / 10000 : 0;
                  return (
                    <tr key={line.productId} className={`${trClass} ${diff !== 0 ? "bg-amber-50" : ""}`}>
                      <td className={`${tdClass} text-gray-900`}>{line.title}</td>
                      <td className={`${tdClass} text-right tabular-nums text-gray-600`}>{line.book}</td>
                      <td className={`${tdClass} text-right`}>
                        <input
                          className={`${fieldBaseClass} ml-auto h-7 w-20 text-right tabular-nums`}
                          value={line.countedQty}
                          onChange={(e) => {
                            const next = [...lines];
                            next[idx] = { ...next[idx], countedQty: e.target.value };
                            setLines(next);
                          }}
                        />
                      </td>
                      <td
                        className={`${tdClass} text-right font-semibold tabular-nums ${
                          diff > 0 ? "text-green-700" : diff < 0 ? "text-red-600" : "text-gray-400"
                        }`}
                      >
                        {diff > 0 ? `+${diff}` : diff < 0 ? diff : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </form>
  );
}
