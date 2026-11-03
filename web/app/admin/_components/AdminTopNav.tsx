// Спільна навігаційна панель адмінки: закріплена зверху на всіх розділах /admin/*.
// Кнопки розділів показуються лише ті, що дозволені в доступі користувача (/api/auth/me).
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Permissions } from "@/lib/auth-rbac";

/** Висота панелі; сторінки з власними sticky-шапками зсуваються на var(--admin-nav-h). */
export const ADMIN_NAV_HEIGHT_PX = 40;

type AdminNavItem = {
  key: string;
  href: string;
  label: string;
  /** Префікси шляху, на яких кнопка підсвічена як поточний розділ. */
  activePrefixes: string[];
};

/**
 * Видимі розділи за доступами. null — доступи ще не завантажені / супер-адмін без обмежень (як у Direct).
 * Логіка 1:1 з колишніми show*-прапорцями сторінки Direct.
 */
export function getAdminNavItems(permissions: Permissions | null): AdminNavItem[] {
  const p = permissions;
  const allowed = (key: keyof Permissions) => p == null || p[key] !== "none";
  const items: AdminNavItem[] = [];

  if (allowed("bankSection")) {
    items.push({ key: "bank", href: "/admin/bank", label: "🏦 Банк", activePrefixes: ["/admin/bank"] });
  }
  if (allowed("paymentReconciliationSection") || allowed("bankSection")) {
    items.push({
      key: "payments",
      href: "/admin/direct/payment-reconciliation",
      label: "Платежі",
      activePrefixes: ["/admin/direct/payment-reconciliation"],
    });
  }
  if (allowed("cashSection") || allowed("financeDocsSection")) {
    items.push({ key: "cash", href: "/admin/finance/cash", label: "Каса", activePrefixes: ["/admin/finance/cash"] });
  }
  if (allowed("financeDocsSection") || allowed("financeReportSection") || allowed("cashSection")) {
    items.push({
      key: "finance",
      href: "/admin/finance",
      label: "Фінанси",
      activePrefixes: ["/admin/finance", "/admin/finance-report"],
    });
  }
  const leadOperationsOnly =
    p != null &&
    p.financeOperationsSection !== "none" &&
    p.financeDocsSection === "none" &&
    p.financeReportSection === "none" &&
    p.cashSection === "none";
  if (leadOperationsOnly) {
    items.push({
      key: "lead-operations",
      href: "/admin/finance/operations",
      label: "Операції лідів",
      activePrefixes: ["/admin/finance/operations"],
    });
  }
  if (allowed("warehouseSection")) {
    items.push({ key: "warehouse", href: "/admin/warehouse", label: "Склад", activePrefixes: ["/admin/warehouse"] });
  }
  if (allowed("journalSection")) {
    items.push({ key: "journal", href: "/admin/journal", label: "Журнал", activePrefixes: ["/admin/journal"] });
  }
  if (allowed("inactiveBaseSection")) {
    items.push({
      key: "clients",
      href: "/admin/direct/inactive-base",
      label: "Клієнти",
      activePrefixes: ["/admin/direct/inactive-base"],
    });
  }
  if (allowed("messagesSection")) {
    items.push({
      key: "messages",
      href: "/admin/direct/messages",
      label: "Переписки",
      activePrefixes: ["/admin/direct/messages"],
    });
  }
  if (allowed("leadsSection") || allowed("statsSection")) {
    items.push({
      key: "leads",
      href: "/admin/direct/stats/consultations",
      label: "Ліди",
      activePrefixes: ["/admin/direct/stats/consultations", "/admin/direct/stats/leads"],
    });
  }
  if (allowed("teamSection")) {
    items.push({ key: "team", href: "/admin/team", label: "Команда", activePrefixes: ["/admin/team"] });
  }
  if (allowed("statsSection")) {
    items.push({ key: "stats", href: "/admin/direct/stats", label: "📈 Статистика", activePrefixes: ["/admin/direct/stats"] });
  }
  return items;
}

/** Найдовший збіг префікса — щоб «Статистика» не світилась на «Лідах» (/admin/direct/stats/consultations). */
function findActiveKey(items: AdminNavItem[], pathname: string): string | null {
  let best: { key: string; len: number } | null = null;
  for (const item of items) {
    for (const prefix of item.activePrefixes) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        if (!best || prefix.length > best.len) best = { key: item.key, len: prefix.length };
      }
    }
  }
  return best?.key ?? null;
}

const NAV_LINK_CLASS = "btn btn-ghost min-h-0 py-0.5 text-[10px] px-1 leading-tight";

/** Кнопки розділів — спільні для панелі та шапки Direct. */
export function AdminNavLinks({
  permissions,
  pathname,
  hrefOverrides,
}: {
  permissions: Permissions | null;
  pathname: string;
  /** Напр. Статистика з фільтрами Direct. */
  hrefOverrides?: Partial<Record<string, string>>;
}) {
  const items = getAdminNavItems(permissions);
  const activeKey = findActiveKey(items, pathname);
  return (
    <>
      {items.map((item) => (
        <Link
          key={item.key}
          href={hrefOverrides?.[item.key] || item.href}
          className={`${NAV_LINK_CLASS} ${activeKey === item.key ? "bg-blue-50 text-blue-700" : ""}`}
          aria-current={activeKey === item.key ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}

type AuthMe = {
  permissions: Permissions | null;
  user: { login: string; name?: string | null } | null;
};

// Один запит /api/auth/me на сесію вкладки (переходи між розділами без перезавантаження).
let authMeCache: AuthMe | null = null;
let authMeInflight: Promise<AuthMe> | null = null;

function loadAuthMe(): Promise<AuthMe> {
  if (authMeCache) return Promise.resolve(authMeCache);
  if (!authMeInflight) {
    authMeInflight = fetch("/api/auth/me", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        const next: AuthMe = data?.ok
          ? { permissions: data.permissions ?? null, user: data.user ?? null }
          : { permissions: {}, user: null };
        authMeCache = next;
        return next;
      })
      .catch(() => ({ permissions: {}, user: null }))
      .finally(() => {
        authMeInflight = null;
      });
  }
  return authMeInflight;
}

/** Де панель не потрібна: поза адмінкою, вхід/вихід, Direct (має власну шапку з тими ж кнопками). */
function isNavHidden(pathname: string): boolean {
  if (!pathname.startsWith("/admin")) return true;
  if (pathname === "/admin/direct") return true;
  if (pathname.startsWith("/admin/login") || pathname.startsWith("/admin/logout")) return true;
  return false;
}

export function AdminTopNav() {
  const pathname = usePathname() || "";
  const hidden = isNavHidden(pathname);
  const [auth, setAuth] = useState<AuthMe | null>(authMeCache);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    void loadAuthMe().then((next) => {
      if (!cancelled) setAuth(next);
    });
    return () => {
      cancelled = true;
    };
  }, [hidden]);

  // CSS-змінна для sticky-шапок розділів: на сторінках без панелі — 0.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--admin-nav-h", hidden ? "0px" : `${ADMIN_NAV_HEIGHT_PX}px`);
  }, [hidden]);

  useEffect(() => {
    if (!isUserMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setIsUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isUserMenuOpen]);

  if (hidden) return null;

  // Поки доступи вантажаться — без кнопок розділів, щоб не мигали заборонені.
  const permissions = auth ? auth.permissions : undefined;
  const user = auth?.user;
  const userLabel = user ? (user.name && user.name.trim() !== "" ? user.name.trim() : user.login) : "";

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-30 bg-white border-b border-gray-200 px-2 flex items-center gap-1"
        style={{ height: ADMIN_NAV_HEIGHT_PX }}
        aria-label="Розділи адмінки"
      >
        <Link
          href="/admin/direct"
          className="flex h-8 w-8 shrink-0 items-center justify-center mr-1"
          title="CreSco — Direct"
          aria-label="CreSco — Direct"
        >
          <img src="/icon-192.png" alt="" width={28} height={28} className="h-7 w-7 rounded-md" />
        </Link>
        <div className="flex items-center gap-0.5 flex-1 min-w-0 justify-end whitespace-nowrap overflow-x-auto">
          {permissions !== undefined && <AdminNavLinks permissions={permissions} pathname={pathname} />}
        </div>
        {userLabel && (
          <div className="relative shrink-0" ref={userMenuRef}>
            <button
              type="button"
              className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1.5 leading-tight"
              onClick={() => setIsUserMenuOpen((v) => !v)}
              title="Меню користувача"
            >
              {userLabel}
            </button>
            {isUserMenuOpen && (
              <div className="absolute right-0 top-full mt-0.5 bg-white border border-gray-300 rounded shadow-lg z-50 min-w-[160px]">
                <div className="p-0.5">
                  <Link
                    href="/admin/logout"
                    className="block w-full text-left px-2 py-1 rounded text-xs hover:bg-base-200 transition-colors"
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    Вийти з системи
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </nav>
      {/* Відступ під fixed-панель */}
      <div aria-hidden="true" style={{ height: ADMIN_NAV_HEIGHT_PX }} />
    </>
  );
}
