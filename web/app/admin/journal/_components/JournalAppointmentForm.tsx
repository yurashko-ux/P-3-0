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
  clientInstagram?: string | null;
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

function avatarUrl(instagram?: string | null) {
  const u = (instagram || "").replace(/^@/, "").trim();
  if (!u) return null;
  return `/api/admin/direct/instagram-avatar?username=${encodeURIComponent(u)}`;
}

function formatVisitDateUa(datetimeLocal: string) {
  if (!datetimeLocal || datetimeLocal.length < 10) return "—";
  const d = new Date(`${datetimeLocal.slice(0, 16)}:00`);
  if (Number.isNaN(d.getTime())) return datetimeLocal.slice(0, 10);
  return d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
}

function formatVisitTimeRange(datetimeLocal: string, durationSec: number) {
  const start = datetimeLocal.slice(11, 16) || "—";
  const startMin = (() => {
    const [h, m] = start.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  })();
  const endMin = startMin + Math.max(0, Math.round((durationSec || 0) / 60));
  const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
  const hours = Math.round(((durationSec || 0) / 3600) * 10) / 10;
  const durLabel =
    hours >= 1
      ? `${hours} ${hours === 1 ? "година" : hours < 5 ? "години" : "годин"}`
      : `${Math.round((durationSec || 0) / 60)} хв`;
  return `${start}–${end} · ${durLabel}`;
}

function StaffPhotoFrame({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
  return (
    <div
      className="w-11 h-11 rounded-lg shrink-0 flex items-center justify-center text-sm font-semibold"
      style={{ background: "#e8edf5", color: "#5b6b7c", border: "1px solid #d5dde8" }}
      aria-hidden
    >
      {initials || "?"}
    </div>
  );
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
    Array<{
      id: string;
      title: string;
      salePrice: number;
      stockQty: number;
      unit: string;
      priceIsCost?: boolean;
      category?: string;
      altegioGoodId: number | null;
    }>
  >([]);
  const [storages, setStorages] = useState<Array<{ id: string; title: string }>>([]);
  const [defaultStorageId, setDefaultStorageId] = useState("");
  const [depositBalance, setDepositBalance] = useState<number | null>(null);
  const [changeLogs, setChangeLogs] = useState<JournalAppointmentDraft["changeLogs"]>([]);
  const [serviceFilter, setServiceFilter] = useState("");
  const [clientInstagram, setClientInstagram] = useState<string | null>(null);
  const [clientPhoneLocal, setClientPhoneLocal] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDirectClientId(draft?.directClientId || "");
    setClientPicked(draft?.clientLabel || "");
    setClientInstagram(draft?.clientInstagram || null);
    setClientPhoneLocal(draft?.clientPhone || null);
    setAvatarBroken(false);
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
      const params = new URLSearchParams();
      if (productQuery.trim()) params.set("q", productQuery.trim());
      if (defaultStorageId) params.set("storageId", defaultStorageId);
      void fetch(`/api/admin/journal/products?${params}`, { credentials: "include" })
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

  const visitDurationSec = useMemo(() => {
    if (draft?.seanceLength && draft.seanceLength > 0) return draft.seanceLength;
    const fromServices = serviceIds.reduce((sum, id) => {
      const s = catalogServices.find((x) => x.id === id);
      return sum + (s?.durationSec || 0);
    }, 0);
    return fromServices > 0 ? fromServices : 3600;
  }, [draft?.seanceLength, serviceIds, catalogServices]);

  const clientAvatarSrc = avatarUrl(clientInstagram);
  const availableExtraMasters = catalogMasters.filter(
    (m) => m.id !== masterId && m.altegioStaffId && !extraStaffIds.includes(Number(m.altegioStaffId)),
  );

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

  const removeExtraStaff = (staffId: number) => {
    setExtraStaffIds((prev) => prev.filter((x) => x !== staffId));
  };

  const addExtraStaff = (staffId: number) => {
    if (!(staffId > 0)) return;
    setExtraStaffIds((prev) => {
      if (prev.includes(staffId) || prev.length >= 2) return prev;
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
            <div className="bg-white rounded-xl border p-3 space-y-3">
              <label className="text-xs text-gray-500 block space-y-1.5">
                <span>Основний працівник</span>
                <select
                  className="select select-bordered select-sm w-full bg-white rounded-lg"
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

              {primaryMaster && (
                <div
                  className="rounded-2xl p-3 space-y-2.5"
                  style={{ background: "#eef2f7" }}
                >
                  <div className="flex items-start gap-2.5">
                    <StaffPhotoFrame name={primaryMaster.name} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-gray-900 truncate leading-tight">
                        {primaryMaster.name}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {primaryMaster.positionTitle || "Майстер"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 pt-0.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-gray-500" aria-hidden>
                      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
                      <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 leading-tight">{formatVisitDateUa(datetime)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatVisitTimeRange(datetime, visitDurationSec)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs text-gray-500">Ще учасники (до 2)</div>
                {extraStaffIds.map((sid) => {
                  const m = catalogMasters.find((x) => Number(x.altegioStaffId) === sid);
                  if (!m) return null;
                  return (
                    <div
                      key={sid}
                      className="rounded-2xl p-3 space-y-2.5 relative"
                      style={{ background: "#eef2f7" }}
                    >
                      <button
                        type="button"
                        className="absolute top-2.5 right-2.5 p-1 text-gray-400 hover:text-red-500"
                        title="Видалити"
                        onClick={() => removeExtraStaff(sid)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path
                            d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <div className="flex items-start gap-2.5 pr-6">
                        <StaffPhotoFrame name={m.name} />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm text-gray-900 truncate leading-tight">{m.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{m.positionTitle || "Асистент"}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-gray-500" aria-hidden>
                          <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
                          <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                        <div className="min-w-0">
                          <p className="text-sm text-gray-900 leading-tight">{formatVisitDateUa(datetime)}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {formatVisitTimeRange(datetime, visitDurationSec)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {extraStaffIds.length < 2 && availableExtraMasters.length > 0 && (
                  <label className="text-xs text-gray-500 block space-y-1.5">
                    <span>Додати учасника</span>
                    <select
                      className="select select-bordered select-sm w-full bg-white rounded-lg"
                      value=""
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (v > 0) addExtraStaff(v);
                      }}
                    >
                      <option value="">Оберіть…</option>
                      {availableExtraMasters.map((m) => (
                        <option key={m.id} value={Number(m.altegioStaffId)}>
                          {m.name}
                          {m.positionTitle ? ` · ${m.positionTitle}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <label className="text-xs text-gray-500 block space-y-1.5">
                <span>Дата і час</span>
                <input
                  className="input input-bordered input-sm w-full bg-white rounded-lg"
                  type="datetime-local"
                  value={datetime}
                  onChange={(e) => setDatetime(e.target.value)}
                />
              </label>
              <label className="text-xs text-gray-500 block space-y-1.5">
                <span>Коментар до запису</span>
                <textarea
                  className="textarea textarea-bordered textarea-sm w-full rounded-lg"
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
            <div className="flex flex-wrap gap-1.5">
              {JOURNAL_ATTENDANCE_OPTIONS.map((opt) => {
                const active = attendance === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAttendance(opt.value)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors border-0"
                    style={{
                      background: active ? "#3e444d" : "#ebedf2",
                      color: active ? "#fff" : "#1f2937",
                    }}
                  >
                    <span
                      className="text-[14px] leading-none font-semibold"
                      style={{ color: active ? "#fff" : opt.iconColor }}
                      aria-hidden
                    >
                      {opt.icon}
                    </span>
                    {opt.short}
                  </button>
                );
              })}
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
                        className="w-full text-left px-2 py-2 text-xs hover:bg-gray-50 flex items-center justify-between gap-2"
                        onClick={() => addProduct(p)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-gray-800">{p.title}</span>
                          <span className="text-[11px] text-gray-500">
                            {p.stockQty} {p.unit || "шт"}
                            {p.priceIsCost ? " · собівартість" : ""}
                          </span>
                        </span>
                        <span className="tabular-nums shrink-0 font-semibold text-gray-900">
                          {money(p.salePrice)} ₴
                        </span>
                      </button>
                    ))}
                    {productHits.length === 0 && (
                      <p className="p-2 text-gray-500 text-xs">
                        Немає товарів із залишком &gt; 0
                        {productQuery.trim() ? " за цим пошуком" : ""}
                      </p>
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
              {draft?.directClientId || directClientId ? (
                <div className="flex gap-3 items-stretch">
                  <div
                    className="w-1/3 min-w-[72px] max-w-[110px] aspect-square rounded-xl overflow-hidden shrink-0 flex items-center justify-center"
                    style={{ background: "#e8edf5", border: "1px solid #d5dde8" }}
                  >
                    {clientAvatarSrc && !avatarBroken ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={clientAvatarSrc}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={() => setAvatarBroken(true)}
                      />
                    ) : (
                      <span className="text-sm font-semibold text-gray-500">
                        {(clientPicked || "?")
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((p) => p[0]?.toUpperCase() || "")
                          .join("") || "?"}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1 flex flex-col justify-center">
                    <p className="font-medium text-sm leading-snug">{clientPicked || "—"}</p>
                    {clientPhoneLocal && (
                      <p className="text-xs text-gray-600">{clientPhoneLocal}</p>
                    )}
                    {clientInstagram && (
                      <p className="text-[11px] text-gray-400 truncate">@{clientInstagram.replace(/^@/, "")}</p>
                    )}
                    {directClientId && (
                      <a
                        className="link text-xs"
                        href={`/admin/direct?highlight=${encodeURIComponent(directClientId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Відкрити в Direct
                      </a>
                    )}
                  </div>
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
                              setClientInstagram(c.instagramUsername || null);
                              setClientPhoneLocal(c.phone || null);
                              setAvatarBroken(false);
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
