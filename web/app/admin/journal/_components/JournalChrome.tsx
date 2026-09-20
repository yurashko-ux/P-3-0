"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { JournalDayProvider, useJournalDay } from "./JournalDayContext";
import { JournalSidebarCalendar } from "./JournalSidebarCalendar";

const JOURNAL_LINKS = [
  { href: "/admin/journal", label: "Календар", exact: true },
  { href: "/admin/journal/services", label: "Послуги" },
  { href: "/admin/journal/staff", label: "Працівники" },
];

const MODULE_LINKS = [
  { href: "/admin/direct", label: "Direct" },
  { href: "/admin/team", label: "Команда" },
  { href: "/admin/finance", label: "Фінанси" },
  { href: "/admin/warehouse", label: "Склад" },
  { href: "/book", label: "Онлайн-запис", external: true },
];

function SidebarInner() {
  const pathname = usePathname();
  const router = useRouter();
  const { day, setDay, sidebarActions } = useJournalDay();

  return (
    <aside className="w-[260px] shrink-0 border-r bg-[#eef0f4] flex flex-col min-h-screen sticky top-0 self-start max-h-screen overflow-y-auto">
      <div className="px-3 pt-3 pb-2">
        <div className="text-sm font-bold tracking-tight">Журнал</div>
        <div className="text-[10px] text-gray-500">Kresco · dual-write Altegio</div>
        {process.env.NEXT_PUBLIC_JOURNAL_SKIP_ALTEGIO !== "0" && (
          <div className="mt-1 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
            Тест: записи й оплати лише в Kresco
          </div>
        )}
      </div>

      <div className="px-2 pb-2">
        <JournalSidebarCalendar />
      </div>

      <div className="px-2 pb-2 space-y-1">
        {sidebarActions.onBook && (
          <button
            type="button"
            className="btn btn-neutral btn-sm w-full min-h-0 h-8"
            onClick={() => {
              if (pathname !== "/admin/journal") router.push("/admin/journal");
              sidebarActions.onBook?.();
            }}
          >
            Записати
          </button>
        )}
        {sidebarActions.onSync && (
          <button
            type="button"
            className="btn btn-ghost btn-sm w-full min-h-0 h-8"
            disabled={sidebarActions.syncing}
            onClick={() => sidebarActions.onSync?.()}
          >
            {sidebarActions.syncing ? "Синхронізація…" : "Підтягнути з Altegio"}
          </button>
        )}
      </div>

      <nav className="px-2 space-y-0.5">
        <div className="text-[10px] uppercase tracking-wide text-gray-500 px-2 py-1">Розділ</div>
        {JOURNAL_LINKS.map((link) => {
          const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`block rounded-lg px-2 py-1.5 text-sm ${
                active ? "bg-white font-medium shadow-sm" : "hover:bg-white/70"
              }`}
              onClick={() => {
                if (link.exact) setDay(day);
              }}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <nav className="px-2 mt-3 pb-4 space-y-0.5 border-t pt-3">
        <div className="text-[10px] uppercase tracking-wide text-gray-500 px-2 py-1">Модулі</div>
        {MODULE_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="block rounded-lg px-2 py-1.5 text-sm hover:bg-white/70"
            {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

function ChromeShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-gray-900 flex">
      <SidebarInner />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}

export function JournalChrome({ children }: { children: React.ReactNode }) {
  return (
    <JournalDayProvider>
      <ChromeShell>{children}</ChromeShell>
    </JournalDayProvider>
  );
}
