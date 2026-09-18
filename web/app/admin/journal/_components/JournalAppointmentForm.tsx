"use client";

import { useEffect, useMemo, useState } from "react";
import {
  JOURNAL_ATTENDANCE_OPTIONS,
  normalizeAttendance,
  type JournalAttendance,
} from "@/lib/journal/attendance";

export type JournalService = {
  id: string;
  title: string;
  kind: string;
  durationSec: number;
  altegioServiceId: number;
};

export type JournalMaster = {
  id: string;
  name: string;
  altegioStaffId: number | null;
  positionTitle?: string;
  positionKind?: string;
};

export type JournalClient = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  instagramUsername: string;
  altegioClientId?: number | null;
  phone?: string | null;
};

export type JournalAppointmentDraft = {
  id?: string;
  directClientId?: string;
  clientLabel?: string;
  clientPhone?: string | null;
  altegioClientId?: number | null;
  altegioRecordId?: number | null;
  masterId?: string;
  datetime?: string;
  seanceLength?: number;
  comment?: string;
  attendance?: number;
  serviceIds?: string[];
  participantStaffIds?: number[];
  goods?: GoodDraft[];
  checkoutStatus?: string | null;
  paidAmount?: number | null;
  totalServices?: number | null;
  changeLogs?: Array<{ id: string; at: string; action: string; summary: string; actor?: string | null }>;
};

type GoodDraft = {
  key: string;
  productId: string;
  storageId: string;
  title: string;
  quantity: number;
  salePrice: number;
  altegioGoodId?: number | null;
};

function clientLabel(c: JournalClient) {
  return [c.lastName, c.firstName].filter(Boolean).join(" ") || c.instagramUsername;
}

function kyivDatetimeLocalNow() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function kyivDayNow() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(new Date());
}

function money(n: number) {
  return n.toLocaleString("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function JournalAppointmentForm({
  open,
  onClose,
  onSaved,
  masters,
  services,
  draft,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  masters: JournalMaster[];
  services: JournalService[];
  draft: JournalAppointmentDraft | null;
  onCheckout?: (appointmentId: string) => void;
}) {
  const [directClientId, setDirectClientId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientHits, setClientHits] = useState<JournalClient[]>([]);
  const [clientPicked, setClientPicked] = useState("");
  const [masterId, setMasterId] = useState("");
  const [extraStaffIds, setExtraStaffIds] = useState<number[]>([]);
  const [datetime, setDatetime] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [goods, setGoods] = useState<GoodDraft[]>([]);
  const [comment, setComment] = useState("");
  const [attendance, setAttendance] = useState<JournalAttendance>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogMasters, setCatalogMasters] = useState<JournalMaster[]>(masters);
  const [catalogServices, setCatalogServices] = useState<JournalService[]>(services);
  const [catalogTab, setCatalogTab] = useState<"services" | "products">("services");
  const [productQuery, setProductQuery] = useState("");
  const [productHits, setProductHits] = useState<
    Array<{ id: string; title: string; salePrice: number; altegioGoodId: number | null }>
  >([]);
  const [storages, setStorages] = useState<Array<{ id: string; title: string }>>([]);
  const [defaultStorageId, setDefaultStorageId] = useState("");
  const [depositBalance, setDepositBalance] = useState<number | null>(null);
  const [changeLogs, setChangeLogs] = useState<JournalAppointmentDraft["changeLogs"]>([]);
  const [serviceFilter, setServiceFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDirectClientId(draft?.directClientId || "");
    setClientPicked(draft?.clientLabel || "");
    setClientQuery("");
    setClientHits([]);
    setDatetime(draft?.datetime || kyivDatetimeLocalNow());
    setServiceIds(draft?.serviceIds || []);
    setGoods(draft?.goods || []);
    setComment(draft?.comment || "");
    setAttendance(normalizeAttendance(draft?.attendance ?? 0));
    setChangeLogs(draft?.changeLogs || []);
    setCatalogTab("services");
    setDepositBalance(null);
    if (draft?.directClientId && !(draft.altegioClientId && draft.altegioClientId > 0)) {
      setError("У клієнта немає id Altegio — запис у журнал неможливий");
    }
  }, [open, draft]);

  useEffect(() => {
    if (!open) return;
    if (masters.length > 0 && services.length > 0) {
      setCatalogMasters(masters);
      setCatalogServices(services);
      return;
    }
    void fetch(`/api/admin/journal/appointments?day=${kyivDayNow()}`, { credentials: "include" })
      .then((r) => r.json())
      .then((json) => {
        if (!json?.ok) throw new Error(json?.error || "Не вдалося завантажити довідник журналу");
        setCatalogMasters(masters.length > 0 ? masters : json.staff || json.masters || []);
        setCatalogServices(services.length > 0 ? services : json.services || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Помилка довідника"));
  }, [open, masters, services]);

  useEffect(() => {
    if (!open) return;
    setMasterId(draft?.masterId || catalogMasters[0]?.id || "");
    const primary = catalogMasters.find((m) => m.id === (draft?.masterId || catalogMasters[0]?.id));
    const primaryStaffId = primary?.altegioStaffId || 0;
    const extras = (draft?.participantStaffIds || []).filter((id) => id > 0 && id !== primaryStaffId).slice(0, 2);
    setExtraStaffIds(extras);
  }, [open, draft, catalogMasters]);

  useEffect(() => {
    if (!open || clientQuery.trim().length < 1 || draft?.directClientId) return;
    const t = setTimeout(() => {
      void fetch(`/api/admin/journal/clients?q=${encodeURIComponent(clientQuery)}`, { credentials: "include" })
        .then((r) => r.json())
        .then((json) => setClientHits(json.clients || []));
    }, 250);
    return () => clearTimeout(t);
  }, [clientQuery, open, draft?.directClientId]);

  useEffect(() => {
    if (!open || !directClientId) return;
    void fetch(`/api/admin/deposits?directClientId=${encodeURIComponent(directClientId)}`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((json) => {
        const accounts = json.accounts || json.deposits || [];
        const sum = (accounts as Array<{ balance?: number }>).reduce(
          (a, x) => a + (Number(x.balance) || 0),
          0,
        );
        setDepositBalance(sum);
      })
      .catch(() => setDepositBalance(null));
  }, [open, directClientId]);

  useEffect(() => {
    if (!open || catalogTab !== "products") return;
    const t = setTimeout(() => {
      void fetch(`/api/admin/journal/products?q=${encodeURIComponent(productQuery || " ")}`, {
        credentials: "include",
      })
        .then((r) => r.json())
        .then((json) => {
          if (!json.ok) return;
          setProductHits(json.products || []);
          setStorages(json.storages || []);
          if (!defaultStorageId && json.storages?.[0]?.id) {
            setDefaultStorageId(json.storages[0].id);
          }
        });
    }, 200);
    return () => clearTimeout(t);
  }, [open, catalogTab, productQuery, defaultStorageId]);

  const primaryMaster = catalogMasters.find((m) => m.id === masterId);
  const servicesTotal = useMemo(() => 0, []); // ціни послуг — після ревізії каталогу; поки з checkout
  const goodsTotal = useMemo(
    () => goods.reduce((a, g) => a + g.salePrice * g.quantity, 0),
    [goods],
  );
  const dueTotal = (draft?.totalServices != null ? Number(draft.totalServices) : servicesTotal) + goodsTotal;
  const paid = Number(draft?.paidAmount) || 0;

  const filteredServices = useMemo(() => {
    const q = serviceFilter.trim().toLowerCase();
    if (!q) return catalogServices;
    return catalogServices.filter((s) => s.title.toLowerCase().includes(q));
  }, [catalogServices, serviceFilter]);

  if (!open) return null;

  const buildParticipantsPayload = () => {
    const primaryId = Number(primaryMaster?.altegioStaffId) || 0;
    const list: Array<{ altegioStaffId: number; staffName?: string; role?: string; isPrimary: boolean }> = [];
    if (primaryId > 0) {
      list.push({
        altegioStaffId: primaryId,
        staffName: primaryMaster?.name,
        role: primaryMaster?.positionKind || "master",
        isPrimary: true,
      });
    }
    for (const sid of extraStaffIds) {
      if (!(sid > 0) || sid === primaryId) continue;
      const m = catalogMasters.find((x) => Number(x.altegioStaffId) === sid);
      list.push({
        altegioStaffId: sid,
        staffName: m?.name,
        role: m?.positionKind || "assistant",
        isPrimary: false,
      });
    }
    return list.slice(0, 3);
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        directClientId,
        masterId,
        datetime,
        comment,
        attendance,
        serviceIds,
        participants: buildParticipantsPayload(),
        goods: goods.map((g) => ({
          productId: g.productId,
          storageId: g.storageId,
          title: g.title,
          quantity: g.quantity,
          salePrice: g.salePrice,
          altegioGoodId: g.altegioGoodId,
        })),
      };
      const url = draft?.id ? `/api/admin/journal/appointments/${draft.id}` : "/api/admin/journal/appointments";
      const res = await fetch(url, {
        method: draft?.id ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка запису");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  };

  const cancelAppt = async () => {
    if (!draft?.id) return;
    if (!confirm("Скасувати запис у Kresco і Altegio?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/journal/appointments/${draft.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка скасування");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  };

  const toggleService = (id: string) => {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleExtraStaff = (staffId: number) => {
    setExtraStaffIds((prev) => {
      if (prev.includes(staffId)) return prev.filter((x) => x !== staffId);
      if (prev.length >= 2) return prev;
      return [...prev, staffId];
    });
  };

  const addProduct = (p: { id: string; title: string; salePrice: number; altegioGoodId: number | null }) => {
    if (!defaultStorageId) {
      setError("Немає складу для товару — перевірте склад");
      return;
    }
    setGoods((prev) => [
      ...prev,
      {
        key: `${p.id}-${Date.now()}`,
        productId: p.id,
        storageId: defaultStorageId,
        title: p.title,
        quantity: 1,
        salePrice: Number(p.salePrice) || 0,
        altegioGoodId: p.altegioGoodId,
      },
    ]);
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-stretch justify-center p-2 md:p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-[#f3f4f6] rounded-xl border w-full max-w-6xl my-2 flex flex-col max-h-[96vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2 shrink-0">
          <p className="font-bold text-base">{draft?.id ? "Запис" : "Новий запис"}</p>
          <span className="text-[11px] text-gray-500">Kresco ↔ Altegio</span>
          <div className="flex-1" />
          {draft?.id && draft.altegioRecordId && onCheckout && (
            <button
              className="btn btn-sm btn-warning"
              disabled={saving}
              onClick={() => {
                onClose();
                onCheckout(draft.id!);
              }}
            >
              {paid > 0 ? "Оплата / чек" : "Оплатити"}
            </button>
          )}
          <button className="btn btn-sm btn-primary" disabled={saving} onClick={() => void submit()}>
            {saving ? "…" : draft?.id ? "Зберегти зміни" : "Записати"}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && <div className="alert alert-error text-sm py-2 mx-3 mt-2">{error}</div>}

        <div className="flex-1 overflow-y-auto p-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Ліва: логістика */}
          <div className="space-y-2">
            <div className="bg-white rounded-xl border p-3 space-y-2">
              <label className="text-xs text-gray-600 block space-y-1">
                <span>Основний працівник</span>
                <select
                  className="select select-bordered select-sm w-full"
                  value={masterId}
                  onChange={(e) => setMasterId(e.target.value)}
                >
                  {catalogMasters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.positionTitle ? ` · ${m.positionTitle}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-xs text-gray-600 space-y-1">
                <span>Ще учасники (до 2, асистент/майстер)</span>
                <div className="max-h-28 overflow-auto border rounded-md p-1 space-y-0.5">
                  {catalogMasters
                    .filter((m) => m.id !== masterId && m.altegioStaffId)
                    .map((m) => (
                      <label key={m.id} className="flex items-center gap-2 px-1 py-0.5">
                        <input
                          type="checkbox"
                          checked={extraStaffIds.includes(Number(m.altegioStaffId))}
                          onChange={() => toggleExtraStaff(Number(m.altegioStaffId))}
                          disabled={
                            !extraStaffIds.includes(Number(m.altegioStaffId)) && extraStaffIds.length >= 2
                          }
                        />
                        <span>
                          {m.name}
                          {m.positionTitle ? ` · ${m.positionTitle}` : ""}
                        </span>
                      </label>
                    ))}
                </div>
              </div>
              <label className="text-xs text-gray-600 block space-y-1">
                <span>Дата і час</span>
                <input
                  className="input input-bordered input-sm w-full"
                  type="datetime-local"
                  value={datetime}
                  onChange={(e) => setDatetime(e.target.value)}
                />
              </label>
              <label className="text-xs text-gray-600 block space-y-1">
                <span>Коментар до запису</span>
                <textarea
                  className="textarea textarea-bordered textarea-sm w-full"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </label>
            </div>

            {draft?.id && (
              <div className="bg-white rounded-xl border p-3 space-y-1">
                <div className="text-xs font-semibold text-gray-700">Історія змін</div>
                <ul className="text-[11px] text-gray-600 space-y-1 max-h-40 overflow-auto">
                  {(changeLogs || []).length === 0 && <li className="text-gray-400">Поки порожньо</li>}
                  {(changeLogs || []).map((log) => (
                    <li key={log.id} className="border-b border-gray-50 pb-1">
                      <span className="tabular-nums text-gray-400">
                        {new Date(log.at).toLocaleString("uk-UA", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>{" "}
                      {log.summary}
                      {log.actor ? ` · ${log.actor}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Центр: статус + послуги/товари */}
          <div className="space-y-2 lg:col-span-1">
            <div className="bg-white rounded-xl border p-2 flex flex-wrap gap-1">
              {JOURNAL_ATTENDANCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`btn btn-sm min-h-0 h-8 flex-1 ${
                    attendance === opt.value ? "btn-neutral" : "btn-ghost"
                  }`}
                  onClick={() => setAttendance(opt.value)}
                >
                  {opt.short}
                </button>
              ))}
            </div>

            <div className="bg-white rounded-xl border p-3 space-y-2">
              <div className="text-xs font-semibold">Обрані послуги</div>
              <ul className="text-sm space-y-1">
                {serviceIds.length === 0 && <li className="text-gray-400 text-xs">Немає</li>}
                {serviceIds.map((id) => {
                  const s = catalogServices.find((x) => x.id === id);
                  return (
                    <li key={id} className="flex justify-between gap-2">
                      <span className="truncate">{s?.title || id}</span>
                      <button type="button" className="text-xs text-red-600" onClick={() => toggleService(id)}>
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="text-xs font-semibold pt-1">Товари</div>
              <ul className="text-sm space-y-1">
                {goods.length === 0 && <li className="text-gray-400 text-xs">Немає</li>}
                {goods.map((g) => (
                  <li key={g.key} className="flex flex-wrap items-center gap-1 text-xs">
                    <span className="flex-1 truncate">{g.title}</span>
                    <input
                      className="input input-bordered input-xs w-14"
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={g.quantity}
                      onChange={(e) =>
                        setGoods((prev) =>
                          prev.map((x) =>
                            x.key === g.key ? { ...x, quantity: Number(e.target.value) || 1 } : x,
                          ),
                        )
                      }
                    />
                    <span className="tabular-nums">{money(g.salePrice * g.quantity)} ₴</span>
                    <button
                      type="button"
                      className="text-red-600"
                      onClick={() => setGoods((prev) => prev.filter((x) => x.key !== g.key))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between text-sm font-medium border-t pt-2">
                <span>До сплати</span>
                <span className="tabular-nums">{money(Math.max(dueTotal, goodsTotal))} ₴</span>
              </div>
              {paid > 0 && (
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Оплачено</span>
                  <span className="tabular-nums">{money(paid)} ₴</span>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border p-3 space-y-2">
              <div className="join w-full">
                <button
                  type="button"
                  className={`btn btn-sm join-item flex-1 ${catalogTab === "services" ? "btn-neutral" : "btn-ghost"}`}
                  onClick={() => setCatalogTab("services")}
                >
                  Послуги
                </button>
                <button
                  type="button"
                  className={`btn btn-sm join-item flex-1 ${catalogTab === "products" ? "btn-neutral" : "btn-ghost"}`}
                  onClick={() => setCatalogTab("products")}
                >
                  Товари
                </button>
              </div>
              {catalogTab === "services" ? (
                <>
                  <input
                    className="input input-bordered input-sm w-full"
                    placeholder="Пошук послуг…"
                    value={serviceFilter}
                    onChange={(e) => setServiceFilter(e.target.value)}
                  />
                  <div className="max-h-52 overflow-auto border rounded-md p-1 space-y-0.5">
                    {filteredServices.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 px-1 py-0.5 text-xs">
                        <input
                          type="checkbox"
                          checked={serviceIds.includes(s.id)}
                          onChange={() => toggleService(s.id)}
                        />
                        <span className="truncate">{s.title}</span>
                      </label>
                    ))}
                    {filteredServices.length === 0 && (
                      <p className="p-2 text-gray-500 text-xs">Немає послуг</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <input
                    className="input input-bordered input-sm w-full"
                    placeholder="Пошук товарів…"
                    value={productQuery}
                    onChange={(e) => setProductQuery(e.target.value)}
                  />
                  {storages.length > 0 && (
                    <select
                      className="select select-bordered select-sm w-full"
                      value={defaultStorageId}
                      onChange={(e) => setDefaultStorageId(e.target.value)}
                    >
                      {storages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="max-h-52 overflow-auto border rounded-md divide-y">
                    {productHits.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-2 py-1.5 text-xs hover:bg-gray-50 flex justify-between gap-2"
                        onClick={() => addProduct(p)}
                      >
                        <span className="truncate">{p.title}</span>
                        <span className="tabular-nums shrink-0">{money(p.salePrice)} ₴</span>
                      </button>
                    ))}
                    {productHits.length === 0 && (
                      <p className="p-2 text-gray-500 text-xs">Введіть пошук або імпортуйте склад</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Права: клієнт */}
          <div className="space-y-2">
            <div className="bg-white rounded-xl border p-3 space-y-2">
              <div className="text-xs font-semibold text-gray-700">Клієнт</div>
              {draft?.directClientId ? (
                <div className="space-y-1">
                  <p className="font-medium text-sm">{clientPicked || "—"}</p>
                  {draft.clientPhone && <p className="text-xs text-gray-600">{draft.clientPhone}</p>}
                  <a
                    className="link text-xs"
                    href={`/admin/direct?highlight=${encodeURIComponent(draft.directClientId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Відкрити в Direct
                  </a>
                </div>
              ) : (
                <div>
                  <input
                    className="input input-bordered input-sm w-full"
                    placeholder="Імʼя, нік, телефон…"
                    value={clientQuery}
                    onChange={(e) => setClientQuery(e.target.value)}
                  />
                  {clientPicked && <p className="text-xs mt-1">{clientPicked}</p>}
                  {clientHits.length > 0 && (
                    <ul className="menu bg-base-100 border rounded-md mt-1 max-h-40 overflow-auto text-xs">
                      {clientHits.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setDirectClientId(c.id);
                              setClientPicked(clientLabel(c));
                              setClientHits([]);
                              setClientQuery("");
                            }}
                          >
                            {clientLabel(c)} · {c.instagramUsername}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {depositBalance != null && depositBalance > 0 && (
                <div className="text-xs bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                  Залишок завдатку: <span className="font-semibold tabular-nums">{money(depositBalance)} ₴</span>
                </div>
              )}
            </div>

            {draft?.id && (
              <button
                className="btn btn-sm btn-error btn-outline w-full"
                disabled={saving}
                onClick={() => void cancelAppt()}
              >
                Скасувати запис
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
