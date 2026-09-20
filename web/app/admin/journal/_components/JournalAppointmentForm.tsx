"use client";

import { useEffect, useMemo, useState } from "react";
import {
  JOURNAL_ATTENDANCE_OPTIONS,
  normalizeAttendance,
  type JournalAttendance,
} from "@/lib/journal/attendance";
import {
  SpendCircleBadge,
  SpendMegaBadge,
  SpendStarBadge,
} from "@/app/admin/direct/_components/DirectClientTableRowBadges";

export type JournalMaster = {
  id: string;
  name: string;
  altegioStaffId: number | null;
  positionTitle?: string;
  positionKind?: string;
  instagramUsername?: string | null;
};

export type JournalService = {
  id: string;
  title: string;
  kind: string;
  durationSec: number;
  altegioServiceId: number;
};

export type JournalClient = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  instagramUsername: string;
  altegioClientId?: number | null;
  phone?: string | null;
  spent?: number | null;
  visits?: number | null;
  lastVisitAt?: string | Date | null;
};

export type ServiceLineDraft = {
  key: string;
  serviceId: string;
  title: string;
  durationSec: number;
  amount: number;
  firstCost: number;
  discountPercent: number;
  staffIds: number[];
  expanded: boolean;
};

type GoodDraft = {
  key: string;
  productId: string;
  storageId: string;
  title: string;
  quantity: number;
  salePrice: number;
  altegioGoodId?: number | null;
  staffIds: number[];
  expanded: boolean;
};

export type JournalAppointmentDraft = {
  id?: string;
  directClientId?: string;
  clientLabel?: string;
  clientPhone?: string | null;
  clientInstagram?: string | null;
  clientSpent?: number | null;
  clientVisits?: number | null;
  clientLastVisitAt?: string | null;
  altegioClientId?: number | null;
  altegioRecordId?: number | null;
  masterId?: string;
  datetime?: string;
  seanceLength?: number;
  comment?: string;
  attendance?: number;
  serviceIds?: string[];
  serviceLines?: Array<{
    key?: string;
    serviceId: string;
    title?: string;
    durationSec?: number;
    amount?: number;
    firstCost?: number;
    cost?: number;
    discountPercent?: number;
    staffIds?: number[];
  }>;
  participantStaffIds?: number[];
  goods?: GoodDraft[];
  checkoutStatus?: string | null;
  paidAmount?: number | null;
  totalServices?: number | null;
  changeLogs?: Array<{ id: string; at: string; action: string; summary: string; actor?: string | null }>;
};

const MAX_TEAM = 5;

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

function formatLastVisitUa(iso?: string | Date | null) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });
}

function formatVisitDateUa(datetimeLocal: string) {
  if (!datetimeLocal || datetimeLocal.length < 10) return "—";
  const d = new Date(`${datetimeLocal.slice(0, 16)}:00`);
  if (Number.isNaN(d.getTime())) return datetimeLocal.slice(0, 10);
  return d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
}

/** Лояльність як у Direct: зірка ≥100k, кружечок з цифрою менше. */
function ClientLoyaltyBadge({ spent }: { spent?: number | null }) {
  const spendValue = (() => {
    const num = typeof spent === "number" ? spent : Number(spent);
    return Number.isFinite(num) ? num : 0;
  })();
  const spendShowMega = spendValue > 1_000_000;
  const spendShowStar = spendValue >= 100_000;
  const spendShowCircleTen = spendValue >= 20_000 && spendValue < 100_000;
  const spendShowCircleOne = spendValue >= 10_000 && spendValue < 20_000;
  const spendCircleRaw = Math.floor(spendValue / 10_000);
  const spendCircleNumber = Math.min(9, Math.max(2, spendCircleRaw));
  const spendStarRaw = Math.floor(spendValue / 100_000);
  const spendStarNumber = Math.min(9, Math.max(1, spendStarRaw));
  const spendShowStarNumber = spendValue > 200_000;

  if (spendShowMega) return <SpendMegaBadge />;
  if (spendShowStar) {
    return (
      <SpendStarBadge
        size={spendShowStarNumber ? 20 : 16}
        number={spendShowStarNumber ? spendStarNumber : undefined}
        fontSize={spendShowStarNumber ? 8 : 11}
      />
    );
  }
  if (spendShowCircleTen) return <SpendCircleBadge size={16} number={spendCircleNumber} />;
  if (spendShowCircleOne) return <SpendCircleBadge size={16} number={1} />;
  return <SpendCircleBadge size={16} />;
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

function lineTotal(firstCost: number, amount: number, discountPercent: number) {
  const base = Math.max(0, Number(firstCost) || 0);
  const qty = Math.max(0, Number(amount) || 0);
  const disc = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  return Math.round(base * qty * (1 - disc / 100) * 100) / 100;
}

function staffAltegioId(m: JournalMaster): number {
  return Number(m.altegioStaffId) || Number(m.id) || 0;
}

function StaffPhotoFrame({
  name,
  instagramUsername,
  size = "md",
  round = false,
}: {
  name: string;
  instagramUsername?: string | null;
  size?: "sm" | "md";
  round?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const src = avatarUrl(instagramUsername);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
  const dim = size === "sm" ? "w-7 h-7 text-[10px]" : "w-11 h-11 text-sm";
  return (
    <div
      className={`${dim} ${round ? "rounded-full" : "rounded-lg"} shrink-0 flex items-center justify-center font-semibold overflow-hidden`}
      style={{ background: "#e8edf5", color: "#5b6b7c", border: "1px solid #d5dde8" }}
      aria-hidden
    >
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="w-full h-full object-cover" onError={() => setBroken(true)} />
      ) : (
        initials || "?"
      )}
    </div>
  );
}

function TrashIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM13 6l3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatDurationUa(sec: number) {
  const m = Math.max(0, Math.round((sec || 0) / 60));
  if (m < 60) return `${m} хв.`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (rest === 0) return `${h} год.`;
  return `${h} год. ${rest} хв.`;
}

function serviceKindLabel(kind: string) {
  if (kind === "consultation") return "Консультація";
  if (kind === "hair") return "Нарощування / волосся";
  return "Інші послуги";
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
  /** Команда запису: altegioStaffId, перший = primary */
  const [teamIds, setTeamIds] = useState<number[]>([]);
  const [datetime, setDatetime] = useState("");
  const [serviceLines, setServiceLines] = useState<ServiceLineDraft[]>([]);
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
  const [defaultStorageId, setDefaultStorageId] = useState("");
  const [depositBalance, setDepositBalance] = useState<number | null>(null);
  const [changeLogs, setChangeLogs] = useState<JournalAppointmentDraft["changeLogs"]>([]);
  const [serviceFilter, setServiceFilter] = useState("");
  const [clientInstagram, setClientInstagram] = useState<string | null>(null);
  const [clientPhoneLocal, setClientPhoneLocal] = useState<string | null>(null);
  const [clientSpent, setClientSpent] = useState<number | null>(null);
  const [clientVisits, setClientVisits] = useState<number | null>(null);
  const [clientLastVisitAt, setClientLastVisitAt] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  /** Якого члена команди зараз замінюємо олівцем (altegioStaffId) */
  const [replacingStaffId, setReplacingStaffId] = useState<number | null>(null);
  const [addStaffOpen, setAddStaffOpen] = useState(false);

  const masterByAltegio = useMemo(() => {
    const map = new Map<number, JournalMaster>();
    for (const m of catalogMasters) {
      const id = staffAltegioId(m);
      if (id > 0) map.set(id, m);
    }
    return map;
  }, [catalogMasters]);

  const teamMembers = useMemo(
    () => teamIds.map((id) => masterByAltegio.get(id)).filter(Boolean) as JournalMaster[],
    [teamIds, masterByAltegio],
  );
  const primaryMaster = teamMembers[0] || null;
  const primaryStaffId = teamIds[0] || 0;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDirectClientId(draft?.directClientId || "");
    setClientPicked(draft?.clientLabel || "");
    setClientInstagram(draft?.clientInstagram || null);
    setClientPhoneLocal(draft?.clientPhone || null);
    setClientSpent(draft?.clientSpent ?? null);
    setClientVisits(draft?.clientVisits ?? null);
    setClientLastVisitAt(draft?.clientLastVisitAt || null);
    setAvatarBroken(false);
    setClientQuery("");
    setClientHits([]);
    setDatetime(draft?.datetime || kyivDatetimeLocalNow());
    setComment(draft?.comment || "");
    setAttendance(normalizeAttendance(draft?.attendance ?? 0));
    setChangeLogs(draft?.changeLogs || []);
    setCatalogTab("services");
    setDepositBalance(draft?.directClientId ? null : 0);
    setReplacingStaffId(null);
    setAddStaffOpen(false);
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

  // Ініціалізація команди + рядків після завантаження каталогу
  useEffect(() => {
    if (!open || catalogMasters.length === 0) return;

    const resolveId = (raw?: string | number | null) => {
      if (raw == null || raw === "") return 0;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && catalogMasters.some((m) => staffAltegioId(m) === n)) return n;
      const byUuid = catalogMasters.find((m) => m.id === String(raw));
      return byUuid ? staffAltegioId(byUuid) : Number.isFinite(n) && n > 0 ? n : 0;
    };

    let nextTeam: number[] = [];
    if (draft?.participantStaffIds && draft.participantStaffIds.length > 0) {
      nextTeam = draft.participantStaffIds.map(Number).filter((id) => id > 0);
    } else {
      const primary = resolveId(draft?.masterId) || staffAltegioId(catalogMasters[0]);
      if (primary > 0) nextTeam = [primary];
    }
    // primary з masterId — на початок
    const primaryFromDraft = resolveId(draft?.masterId);
    if (primaryFromDraft > 0) {
      nextTeam = [primaryFromDraft, ...nextTeam.filter((id) => id !== primaryFromDraft)];
    }
    nextTeam = [...new Set(nextTeam)].slice(0, MAX_TEAM);
    setTeamIds(nextTeam);

    const defaultStaff = nextTeam.length > 0 ? nextTeam : [];

    if (draft?.serviceLines && draft.serviceLines.length > 0) {
      setServiceLines(
        draft.serviceLines.map((l, i) => {
          const svc = catalogServices.find((s) => s.id === l.serviceId);
          const first =
            l.firstCost != null && Number(l.firstCost) > 0
              ? Number(l.firstCost)
              : Number(l.cost) || 0;
          return {
            key: l.key || `${l.serviceId}-${i}`,
            serviceId: l.serviceId,
            title: l.title || svc?.title || l.serviceId,
            durationSec: l.durationSec || svc?.durationSec || 0,
            amount: Number(l.amount) > 0 ? Number(l.amount) : 1,
            firstCost: first,
            discountPercent: Number(l.discountPercent) || 0,
            staffIds:
              Array.isArray(l.staffIds) && l.staffIds.length > 0
                ? l.staffIds.map(Number).filter((id) => id > 0)
                : [...defaultStaff],
            expanded: false,
          };
        }),
      );
    } else if (draft?.serviceIds && draft.serviceIds.length > 0) {
      setServiceLines(
        draft.serviceIds.map((id, i) => {
          const svc = catalogServices.find((s) => s.id === id);
          return {
            key: `${id}-${i}`,
            serviceId: id,
            title: svc?.title || id,
            durationSec: svc?.durationSec || 0,
            amount: 1,
            firstCost: 0,
            discountPercent: 0,
            staffIds: [...defaultStaff],
            expanded: false,
          };
        }),
      );
    } else {
      setServiceLines([]);
    }

    setGoods(
      (draft?.goods || []).map((g) => ({
        ...g,
        staffIds:
          Array.isArray(g.staffIds) && g.staffIds.length > 0
            ? g.staffIds.map(Number).filter((id) => id > 0)
            : [...defaultStaff],
        expanded: Boolean(g.expanded),
      })),
    );
  }, [open, draft, catalogMasters, catalogServices]);

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
      .catch(() => setDepositBalance(0));
  }, [open, directClientId]);

  useEffect(() => {
    if (!open || catalogTab !== "products") return;
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (productQuery.trim()) params.set("q", productQuery.trim());
      void fetch(`/api/admin/journal/products?${params}`, { credentials: "include" })
        .then((r) => r.json())
        .then((json) => {
          if (!json.ok) return;
          setProductHits(json.products || []);
          const storage = json.storage || json.storages?.[0] || null;
          if (storage?.id) setDefaultStorageId(storage.id);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [open, catalogTab, productQuery]);

  const servicesTotal = useMemo(
    () => serviceLines.reduce((a, l) => a + lineTotal(l.firstCost, l.amount, l.discountPercent), 0),
    [serviceLines],
  );
  const goodsTotal = useMemo(
    () => goods.reduce((a, g) => a + g.salePrice * g.quantity, 0),
    [goods],
  );
  const dueTotal = servicesTotal + goodsTotal;
  const paid = Number(draft?.paidAmount) || 0;

  const filteredServices = useMemo(() => {
    const q = serviceFilter.trim().toLowerCase();
    if (!q) return catalogServices;
    return catalogServices.filter((s) => s.title.toLowerCase().includes(q));
  }, [catalogServices, serviceFilter]);

  const visitDurationSec = useMemo(() => {
    if (draft?.seanceLength && draft.seanceLength > 0) return draft.seanceLength;
    const fromServices = serviceLines.reduce((sum, l) => sum + (l.durationSec || 0) * (l.amount || 1), 0);
    return fromServices > 0 ? fromServices : 3600;
  }, [draft?.seanceLength, serviceLines]);

  const clientAvatarSrc = avatarUrl(clientInstagram);
  const servicesByKind = useMemo(() => {
    const map = new Map<string, JournalService[]>();
    for (const s of filteredServices) {
      const k = s.kind || "other";
      const list = map.get(k) || [];
      list.push(s);
      map.set(k, list);
    }
    const order = ["consultation", "hair", "other"];
    return order
      .filter((k) => (map.get(k) || []).length > 0)
      .map((k) => ({ kind: k, label: serviceKindLabel(k), items: map.get(k) || [] }));
  }, [filteredServices]);
  const productsByCategory = useMemo(() => {
    const map = new Map<string, typeof productHits>();
    for (const p of productHits) {
      const cat = p.category || "Інше";
      const list = map.get(cat) || [];
      list.push(p);
      map.set(cat, list);
    }
    const isKhvosty = (title: string) => /хвости/i.test(title);
    return [...map.entries()]
      .sort((a, b) => {
        const aK = isKhvosty(a[0]) ? 0 : 1;
        const bK = isKhvosty(b[0]) ? 0 : 1;
        if (aK !== bK) return aK - bK;
        return a[0].localeCompare(b[0], "uk");
      })
      .map(([title, items]) => ({ title, items }));
  }, [productHits]);

  const availableToAdd = useMemo(
    () => catalogMasters.filter((m) => !teamIds.includes(staffAltegioId(m))),
    [catalogMasters, teamIds],
  );

  if (!open) return null;

  const propagateAddStaff = (staffId: number) => {
    setServiceLines((prev) =>
      prev.map((l) => (l.staffIds.includes(staffId) ? l : { ...l, staffIds: [...l.staffIds, staffId] })),
    );
    setGoods((prev) =>
      prev.map((g) => (g.staffIds.includes(staffId) ? g : { ...g, staffIds: [...g.staffIds, staffId] })),
    );
  };

  const propagateRemoveStaff = (staffId: number) => {
    setServiceLines((prev) =>
      prev.map((l) => ({ ...l, staffIds: l.staffIds.filter((id) => id !== staffId) })),
    );
    setGoods((prev) => prev.map((g) => ({ ...g, staffIds: g.staffIds.filter((id) => id !== staffId) })));
  };

  const propagateReplaceStaff = (oldId: number, newId: number) => {
    setServiceLines((prev) =>
      prev.map((l) => {
        if (!l.staffIds.includes(oldId)) {
          return l.staffIds.includes(newId) ? l : { ...l, staffIds: [...l.staffIds, newId] };
        }
        return {
          ...l,
          staffIds: [...new Set(l.staffIds.map((id) => (id === oldId ? newId : id)))],
        };
      }),
    );
    setGoods((prev) =>
      prev.map((g) => {
        if (!g.staffIds.includes(oldId)) {
          return g.staffIds.includes(newId) ? g : { ...g, staffIds: [...g.staffIds, newId] };
        }
        return {
          ...g,
          staffIds: [...new Set(g.staffIds.map((id) => (id === oldId ? newId : id)))],
        };
      }),
    );
  };

  const addToTeam = (staffId: number) => {
    if (!(staffId > 0) || teamIds.includes(staffId)) return;
    if (teamIds.length >= MAX_TEAM) {
      setError(`Максимум ${MAX_TEAM} учасників у команді запису`);
      return;
    }
    setTeamIds((prev) => [...prev, staffId]);
    propagateAddStaff(staffId);
    setAddStaffOpen(false);
    setError(null);
  };

  const removeFromTeam = (staffId: number) => {
    if (teamIds.length <= 1) {
      setError("У записі має залишитись хоча б один працівник");
      return;
    }
    setTeamIds((prev) => prev.filter((id) => id !== staffId));
    propagateRemoveStaff(staffId);
    setReplacingStaffId(null);
    setError(null);
  };

  const replaceInTeam = (oldId: number, newId: number) => {
    if (!(newId > 0) || newId === oldId) {
      setReplacingStaffId(null);
      return;
    }
    if (teamIds.includes(newId)) {
      setError("Цей працівник уже в команді запису");
      setReplacingStaffId(null);
      return;
    }
    setTeamIds((prev) => prev.map((id) => (id === oldId ? newId : id)));
    propagateReplaceStaff(oldId, newId);
    setReplacingStaffId(null);
    setError(null);
  };

  const removeStaffFromServiceLine = (key: string, staffId: number) => {
    setServiceLines((prev) =>
      prev.map((l) =>
        l.key === key ? { ...l, staffIds: l.staffIds.filter((id) => id !== staffId) } : l,
      ),
    );
  };

  const removeStaffFromGoodLine = (key: string, staffId: number) => {
    setGoods((prev) =>
      prev.map((g) =>
        g.key === key ? { ...g, staffIds: g.staffIds.filter((id) => id !== staffId) } : g,
      ),
    );
  };

  const emptyStaffLines = () => {
    const badServices = serviceLines.filter((l) => l.staffIds.length === 0);
    const badGoods = goods.filter((g) => g.staffIds.length === 0);
    return { badServices, badGoods };
  };

  const buildParticipantsPayload = () => {
    return teamIds
      .map((id, i) => {
        const m = masterByAltegio.get(id);
        return {
          altegioStaffId: id,
          staffName: m?.name,
          role: m?.positionKind || "master",
          isPrimary: i === 0,
        };
      })
      .filter((p) => p.altegioStaffId > 0);
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (teamIds.length === 0 || !primaryStaffId) {
        throw new Error("Додайте хоча б одного працівника в команду запису");
      }
      if (serviceLines.length === 0) {
        throw new Error("Оберіть послугу");
      }
      const { badServices, badGoods } = emptyStaffLines();
      if (badServices.length > 0 || badGoods.length > 0) {
        const names = [
          ...badServices.map((l) => l.title),
          ...badGoods.map((g) => g.title),
        ].slice(0, 3);
        throw new Error(
          `На рядку має бути хоча б один виконавець: ${names.join(", ")}${names.length >= 3 ? "…" : ""}`,
        );
      }
      const payload = {
        directClientId,
        masterId: String(primaryStaffId),
        datetime,
        comment,
        attendance,
        serviceIds: serviceLines.map((l) => l.serviceId),
        serviceLines: serviceLines.map((l) => ({
          serviceId: l.serviceId,
          amount: l.amount,
          firstCost: l.firstCost,
          discountPercent: l.discountPercent,
          cost: lineTotal(l.firstCost, l.amount, l.discountPercent),
          staffIds: l.staffIds,
        })),
        participants: buildParticipantsPayload(),
        goods: goods.map((g) => ({
          productId: g.productId,
          storageId: g.storageId,
          title: g.title,
          quantity: g.quantity,
          salePrice: g.salePrice,
          altegioGoodId: g.altegioGoodId,
          staffIds: g.staffIds,
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
    if (!confirm("Ви дійсно хочете видалити цей запис?")) return;
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
    setServiceLines((prev) => {
      const exists = prev.find((l) => l.serviceId === id);
      if (exists) return prev.filter((l) => l.serviceId !== id);
      const svc = catalogServices.find((s) => s.id === id);
      return [
        ...prev,
        {
          key: `${id}-${Date.now()}`,
          serviceId: id,
          title: svc?.title || id,
          durationSec: svc?.durationSec || 0,
          amount: 1,
          firstCost: 0,
          discountPercent: 0,
          staffIds: [...teamIds],
          expanded: false,
        },
      ];
    });
  };

  const addProduct = (p: {
    id: string;
    title: string;
    salePrice: number;
    altegioGoodId: number | null;
    storageId?: string;
  }) => {
    const storageId = p.storageId || defaultStorageId;
    if (!storageId) {
      setError("Немає складу «Товари» — перевірте склад у системі");
      return;
    }
    setGoods((prev) => [
      ...prev,
      {
        key: `${p.id}-${Date.now()}`,
        productId: p.id,
        storageId,
        title: p.title,
        quantity: 1,
        salePrice: Number(p.salePrice) || 0,
        altegioGoodId: p.altegioGoodId,
        staffIds: [...teamIds],
        expanded: false,
      },
    ]);
  };

  const renderLineStaffChips = (
    staffIds: number[],
    onRemove: (staffId: number) => void,
    round: boolean,
  ) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {staffIds.map((id) => {
        const m = masterByAltegio.get(id);
        return (
          <div
            key={id}
            className="inline-flex items-center gap-1 pl-0.5 pr-1 py-0.5 rounded-lg bg-gray-50 border border-gray-100"
            title={m?.name || String(id)}
          >
            <StaffPhotoFrame
              name={m?.name || "?"}
              instagramUsername={m?.instagramUsername}
              size="sm"
              round={round}
            />
            <span className="text-[11px] text-gray-700 max-w-[120px] truncate">{m?.name || id}</span>
            <button
              type="button"
              className="text-gray-400 hover:text-red-600 p-0.5"
              title="Прибрати з цього рядка"
              onClick={() => onRemove(id)}
            >
              <TrashIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
      {staffIds.length === 0 && (
        <span className="text-[11px] text-red-600">Немає виконавця — збереження заблоковано</span>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-stretch justify-center p-2 md:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-[#f3f4f6] rounded-xl border w-full max-w-6xl my-2 flex flex-col max-h-[96vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2 shrink-0">
          <p className="font-bold text-base">{draft?.id ? "Запис" : "Новий запис"}</p>
          <span className="text-[11px] text-gray-500">Kresco ↔ Altegio</span>
          <div className="flex-1" />
          {draft?.id && (
            <button
              type="button"
              className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
              title="Скасувати запис"
              disabled={saving}
              onClick={() => void cancelAppt()}
            >
              <TrashIcon className="w-5 h-5" />
            </button>
          )}
          {draft?.id && draft.altegioRecordId && onCheckout && (
            <button
              className="btn btn-sm border-0 text-white"
              style={{ background: "#f59e0b" }}
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

        {error && <div className="alert alert-error text-sm py-2 mx-3 mt-2 shrink-0">{error}</div>}

        {/* Ліва вужча · центр ширший · права вужча */}
        <div className="flex-1 min-h-0 overflow-hidden p-3 grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Ліва: команда + логістика */}
          <div className="space-y-2 lg:col-span-3 overflow-y-auto min-h-0">
            <div className="bg-white rounded-xl border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-700">Команда запису</span>
                <button
                  type="button"
                  className="text-[11px] text-blue-700 hover:underline"
                  onClick={() => {
                    setAddStaffOpen((v) => !v);
                    setReplacingStaffId(null);
                  }}
                >
                  + додати
                </button>
              </div>

              {(addStaffOpen || replacingStaffId != null) && (
                <select
                  className="select select-bordered select-sm w-full bg-white rounded-lg"
                  defaultValue=""
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (!(id > 0)) return;
                    if (replacingStaffId != null) replaceInTeam(replacingStaffId, id);
                    else addToTeam(id);
                    e.target.value = "";
                  }}
                >
                  <option value="" disabled>
                    {replacingStaffId != null ? "Замінити на…" : "Додати майстра / асистента…"}
                  </option>
                  {(replacingStaffId != null
                    ? catalogMasters.filter((m) => !teamIds.includes(staffAltegioId(m)))
                    : availableToAdd
                  ).map((m) => (
                    <option key={m.id} value={staffAltegioId(m)}>
                      {m.name}
                      {m.positionTitle ? ` · ${m.positionTitle}` : ""}
                    </option>
                  ))}
                </select>
              )}

              <div className="space-y-2">
                {teamMembers.map((m, idx) => {
                  const sid = staffAltegioId(m);
                  return (
                    <div
                      key={sid}
                      className="rounded-2xl p-2.5"
                      style={{ background: idx === 0 ? "#eef2f7" : "#f7f8fa" }}
                    >
                      <div className="flex items-start gap-2">
                        <StaffPhotoFrame name={m.name} instagramUsername={m.instagramUsername} />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm text-gray-900 leading-snug break-words">
                            {m.name}
                          </p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {m.positionTitle || (idx === 0 ? "Основний" : "Учасник")}
                            {idx === 0 ? " · колонка календаря" : ""}
                          </p>
                          <div className="flex justify-end gap-0.5 mt-1.5">
                            <button
                              type="button"
                              className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-white/60"
                              title="Замінити"
                              onClick={() => {
                                setReplacingStaffId(sid);
                                setAddStaffOpen(false);
                              }}
                            >
                              <PencilIcon />
                            </button>
                            <button
                              type="button"
                              className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-white/60"
                              title="Прибрати з запису"
                              onClick={() => removeFromTeam(sid)}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {teamMembers.length === 0 && (
                  <p className="text-xs text-gray-400">Додайте працівника</p>
                )}
              </div>

              {primaryMaster && (
                <div className="flex items-start gap-2 pt-1 border-t border-gray-100">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="mt-0.5 shrink-0 text-gray-500"
                    aria-hidden
                  >
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
              )}

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

          {/* Центр: статус + обрані + каталог */}
          <div className="lg:col-span-6 flex flex-col min-h-0 gap-2 overflow-hidden">
            <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5 shrink-0">
              {JOURNAL_ATTENDANCE_OPTIONS.map((opt) => {
                const active = attendance === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAttendance(opt.value)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] sm:text-[12px] font-medium transition-colors border-0 whitespace-nowrap shrink-0"
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

            <div className="bg-white rounded-xl border p-3 space-y-2 shrink-0 max-h-[40%] overflow-y-auto">
              <div className="text-xs font-semibold">
                Обрані{" "}
                {primaryMaster ? (
                  <span className="font-normal text-gray-500">
                    · {primaryMaster.name.split(/\s+/)[0]}
                    {visitDurationSec >= 3600
                      ? ` · ${Math.round((visitDurationSec / 3600) * 10) / 10} год.`
                      : ""}
                  </span>
                ) : null}
              </div>

              <ul className="space-y-0.5">
                {serviceLines.length === 0 && goods.length === 0 && (
                  <li className="text-gray-400 text-xs py-1">Немає послуг і товарів</li>
                )}
                {serviceLines.map((l) => {
                  const total = lineTotal(l.firstCost, l.amount, l.discountPercent);
                  const baseShown = l.firstCost * l.amount;
                  return (
                    <li key={l.key} className="border border-gray-100 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-gray-50"
                        onClick={() =>
                          setServiceLines((prev) =>
                            prev.map((x) =>
                              x.key === l.key ? { ...x, expanded: !x.expanded } : x,
                            ),
                          )
                        }
                      >
                        <div className="flex -space-x-1.5 shrink-0">
                          {l.staffIds.slice(0, 2).map((id) => {
                            const m = masterByAltegio.get(id);
                            return (
                              <StaffPhotoFrame
                                key={id}
                                name={m?.name || "?"}
                                instagramUsername={m?.instagramUsername}
                                size="sm"
                                round={false}
                              />
                            );
                          })}
                        </div>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-gray-900">
                          {l.title}
                        </span>
                        {l.discountPercent > 0 && (
                          <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 shrink-0">
                            −{l.discountPercent}%
                          </span>
                        )}
                        <span className="text-[13px] font-semibold tabular-nums shrink-0 whitespace-nowrap">
                          {money(total)} ₴
                        </span>
                        {l.discountPercent > 0 && baseShown > total && (
                          <span className="text-[11px] text-gray-400 line-through tabular-nums shrink-0 whitespace-nowrap">
                            {money(baseShown)} ₴
                          </span>
                        )}
                        <span className="text-gray-400 text-[10px] shrink-0 w-3 text-center">
                          {l.expanded ? "▲" : "▼"}
                        </span>
                      </button>
                      {l.expanded && (
                        <div className="px-2 pb-2 pt-1 border-t border-gray-50 space-y-1.5 bg-gray-50/50">
                          <div className="grid grid-cols-4 gap-1.5">
                            <label className="text-[10px] text-gray-500 space-y-0.5">
                              <span>К-сть</span>
                              <input
                                className="w-full h-7 px-1.5 text-xs rounded border border-gray-200 bg-white"
                                type="number"
                                min={1}
                                step={1}
                                value={l.amount}
                                onChange={(e) =>
                                  setServiceLines((prev) =>
                                    prev.map((x) =>
                                      x.key === l.key
                                        ? { ...x, amount: Math.max(1, Number(e.target.value) || 1) }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label className="text-[10px] text-gray-500 space-y-0.5">
                              <span>Ціна</span>
                              <input
                                className="w-full h-7 px-1.5 text-xs rounded border border-gray-200 bg-white"
                                type="number"
                                min={0}
                                step={1}
                                value={l.firstCost}
                                onChange={(e) =>
                                  setServiceLines((prev) =>
                                    prev.map((x) =>
                                      x.key === l.key
                                        ? { ...x, firstCost: Math.max(0, Number(e.target.value) || 0) }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label className="text-[10px] text-gray-500 space-y-0.5">
                              <span>Знижка,%</span>
                              <input
                                className="w-full h-7 px-1.5 text-xs rounded border border-gray-200 bg-white"
                                type="number"
                                min={0}
                                max={100}
                                step={10}
                                value={l.discountPercent}
                                onChange={(e) =>
                                  setServiceLines((prev) =>
                                    prev.map((x) =>
                                      x.key === l.key
                                        ? {
                                            ...x,
                                            discountPercent: Math.min(
                                              100,
                                              Math.max(0, Number(e.target.value) || 0),
                                            ),
                                          }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label className="text-[10px] text-gray-500 space-y-0.5">
                              <span>Разом</span>
                              <div className="w-full h-7 px-1.5 text-xs rounded border border-gray-200 bg-white flex items-center tabular-nums">
                                {money(total)}
                              </div>
                            </label>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] text-gray-500 mb-0.5">Хто робить</div>
                              {renderLineStaffChips(
                                l.staffIds,
                                (id) => removeStaffFromServiceLine(l.key, id),
                                false,
                              )}
                            </div>
                            <button
                              type="button"
                              className="p-1 rounded text-gray-400 hover:text-red-600 shrink-0"
                              title="Видалити послугу"
                              onClick={() =>
                                setServiceLines((prev) => prev.filter((x) => x.key !== l.key))
                              }
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}

                {goods.map((g) => {
                  const total = g.salePrice * g.quantity;
                  return (
                    <li key={g.key} className="border border-gray-100 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-gray-50"
                        onClick={() =>
                          setGoods((prev) =>
                            prev.map((x) =>
                              x.key === g.key ? { ...x, expanded: !x.expanded } : x,
                            ),
                          )
                        }
                      >
                        <div className="flex -space-x-1.5 shrink-0">
                          {g.staffIds.slice(0, 2).map((id) => {
                            const m = masterByAltegio.get(id);
                            return (
                              <StaffPhotoFrame
                                key={id}
                                name={m?.name || "?"}
                                instagramUsername={m?.instagramUsername}
                                size="sm"
                                round
                              />
                            );
                          })}
                        </div>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-gray-900">
                          {g.title}
                        </span>
                        <span className="text-[13px] font-semibold tabular-nums shrink-0 whitespace-nowrap">
                          {money(total)} ₴
                        </span>
                        <span className="text-gray-400 text-[10px] shrink-0 w-3 text-center">
                          {g.expanded ? "▲" : "▼"}
                        </span>
                      </button>
                      {g.expanded && (
                        <div className="px-2 pb-2 pt-1 border-t border-gray-50 space-y-1.5 bg-gray-50/50">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="text-[10px] text-gray-500 space-y-0.5">
                              <span>К-сть</span>
                              <input
                                className="w-16 h-7 px-1.5 text-xs rounded border border-gray-200 bg-white"
                                type="number"
                                min={1}
                                step={1}
                                value={g.quantity}
                                onChange={(e) =>
                                  setGoods((prev) =>
                                    prev.map((x) =>
                                      x.key === g.key
                                        ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <span className="text-xs tabular-nums text-gray-600">
                              {money(g.salePrice)} ₴ / шт.
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] text-gray-500 mb-0.5">Хто продав</div>
                              {renderLineStaffChips(
                                g.staffIds,
                                (id) => removeStaffFromGoodLine(g.key, id),
                                true,
                              )}
                            </div>
                            <button
                              type="button"
                              className="p-1 rounded text-gray-400 hover:text-red-600 shrink-0"
                              title="Видалити товар"
                              onClick={() => setGoods((prev) => prev.filter((x) => x.key !== g.key))}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className="flex justify-between items-center text-sm font-medium border-t pt-2">
                <span>До сплати</span>
                <span className="tabular-nums">{money(dueTotal)} ₴</span>
              </div>
              {paid > 0 && (
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Оплачено</span>
                  <span className="tabular-nums">{money(paid)} ₴</span>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border p-3 space-y-2 flex-1 min-h-0 flex flex-col">
              <div className="flex gap-1 p-1 rounded-xl bg-gray-100 shrink-0">
                <button
                  type="button"
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                    catalogTab === "services" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
                  }`}
                  onClick={() => setCatalogTab("services")}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M6 8h12M6 12h12M6 16h8"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                  Послуги
                </button>
                <button
                  type="button"
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                    catalogTab === "products" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
                  }`}
                  onClick={() => setCatalogTab("products")}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M4 9h16l-1.2 10.2A2 2 0 0 1 16.8 21H7.2a2 2 0 0 1-2-1.8L4 9zM9 9V6a3 3 0 0 1 6 0v3"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Товари
                </button>
              </div>
              {catalogTab === "services" ? (
                <>
                  <input
                    className="input input-bordered input-sm w-full rounded-xl shrink-0"
                    placeholder="Пошук послуг…"
                    value={serviceFilter}
                    onChange={(e) => setServiceFilter(e.target.value)}
                  />
                  <div className="flex-1 min-h-0 overflow-auto space-y-1">
                    {servicesByKind.map((group) => (
                      <details
                        key={group.kind}
                        className="rounded-lg border border-gray-100 bg-white group/cat"
                      >
                        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium text-gray-800 list-none flex items-center justify-between hover:bg-gray-50 rounded-lg">
                          <span className="flex items-center gap-1.5">
                            <span className="text-gray-400 text-[10px] group-open/cat:rotate-90 inline-block transition-transform">
                              ▸
                            </span>
                            {group.label}
                          </span>
                          <span className="text-gray-400 tabular-nums">{group.items.length}</span>
                        </summary>
                        <div className="border-t border-gray-50 divide-y divide-gray-50">
                          {group.items.map((s) => {
                            const selected = serviceLines.some((l) => l.serviceId === s.id);
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => toggleService(s.id)}
                                className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2"
                                style={{ background: selected ? "#f3f6fb" : undefined }}
                              >
                                <span
                                  className="w-5 h-5 rounded shrink-0 flex items-center justify-center text-[9px] font-semibold"
                                  style={{
                                    background: selected ? "#dbe4f0" : "#e8edf5",
                                    color: "#5b6b7c",
                                  }}
                                >
                                  {selected ? "✓" : "П"}
                                </span>
                                <span className="flex-1 min-w-0 truncate font-medium text-gray-800">
                                  {s.title}
                                </span>
                                <span className="text-[9px] text-gray-500 shrink-0">
                                  {formatDurationUa(s.durationSec)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </details>
                    ))}
                    {servicesByKind.length === 0 && (
                      <p className="p-2 text-gray-500 text-xs">Немає послуг</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <input
                    className="input input-bordered input-sm w-full rounded-xl shrink-0"
                    placeholder="Пошук товарів…"
                    value={productQuery}
                    onChange={(e) => setProductQuery(e.target.value)}
                  />
                  <div className="flex-1 min-h-0 overflow-auto space-y-1">
                    {productsByCategory.map((group) => (
                      <details
                        key={group.title}
                        className="rounded-lg border border-gray-100 bg-white group/cat"
                      >
                        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium text-gray-800 list-none flex items-center justify-between hover:bg-gray-50 rounded-lg">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="text-gray-400 text-[10px] group-open/cat:rotate-90 inline-block transition-transform shrink-0">
                              ▸
                            </span>
                            <span className="truncate">{group.title}</span>
                          </span>
                          <span className="text-gray-400 tabular-nums shrink-0 ml-2">
                            {group.items.length}
                          </span>
                        </summary>
                        <div className="border-t border-gray-50 divide-y divide-gray-50">
                          {group.items.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-gray-50 flex items-center justify-between gap-2"
                              onClick={() => addProduct(p)}
                            >
                              <span className="min-w-0 flex-1 flex items-center gap-2">
                                <span
                                  className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-semibold"
                                  style={{ background: "#e8edf5", color: "#5b6b7c" }}
                                >
                                  Т
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-gray-800">
                                    {p.title}
                                  </span>
                                  <span className="text-[10px] text-gray-500">{p.stockQty} шт.</span>
                                </span>
                              </span>
                              <span className="tabular-nums shrink-0 font-semibold text-gray-900">
                                {money(p.salePrice)} ₴
                              </span>
                            </button>
                          ))}
                        </div>
                      </details>
                    ))}
                    {productsByCategory.length === 0 && (
                      <p className="p-2 text-gray-500 text-xs">
                        Немає товарів із залишком &gt; 0 на складі «Товари»
                        {productQuery.trim() ? " за цим пошуком" : ""}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Права: клієнт */}
          <div className="space-y-2 lg:col-span-3 overflow-y-auto min-h-0">
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
                    <p className="font-medium text-sm leading-snug flex items-start gap-1.5">
                      <span className="mt-0.5 shrink-0">
                        <ClientLoyaltyBadge spent={clientSpent} />
                      </span>
                      <span className="min-w-0">
                        {clientPicked || "—"}
                        {clientVisits != null ? (
                          <span className="text-gray-500 font-normal"> ({clientVisits})</span>
                        ) : null}
                      </span>
                    </p>
                    {clientPhoneLocal && (
                      <p className="text-xs text-gray-600">{clientPhoneLocal}</p>
                    )}
                    {clientInstagram && (
                      <p className="text-[11px] text-gray-400 truncate">
                        @{clientInstagram.replace(/^@/, "")}
                      </p>
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
                              setClientSpent(c.spent ?? null);
                              setClientVisits(c.visits ?? null);
                              setClientLastVisitAt(
                                c.lastVisitAt
                                  ? typeof c.lastVisitAt === "string"
                                    ? c.lastVisitAt
                                    : c.lastVisitAt.toISOString()
                                  : null,
                              );
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
              <div className="text-xs bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                Завдаток:{" "}
                <span className="font-semibold tabular-nums">
                  {money(depositBalance != null ? depositBalance : 0)} ₴
                </span>
              </div>
              <div className="text-xs text-gray-600">
                Останній візит:{" "}
                <span className="font-medium text-gray-800">{formatLastVisitUa(clientLastVisitAt)}</span>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline w-full"
                disabled
                title="Скоро: історія відвідувань клієнта"
              >
                Історія відвідувань
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
