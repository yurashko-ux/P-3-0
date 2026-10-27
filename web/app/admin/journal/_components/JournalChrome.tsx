"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { JournalDayProvider, useJournalDay } from "./JournalDayContext";
import { JournalSidebarCalendar } from "./JournalSidebarCalendar";

const JOURNAL_LINKS = [
  { href: "/admin/journal", label: "Календар", exact: true },
  { href: "/admin/journal/schedule", label: "Графік" },
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
    <aside className="hidden lg:flex w-[260px] shrink-0 border-r bg-[#eef0f4] flex-col min-h-screen sticky top-0 self-start max-h-screen overflow-y-auto">
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

function MobileDock() {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarActions } = useJournalDay();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const onJournal = pathname === "/admin/journal";

  return (
    <>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-gray-200/80 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4 items-stretch h-[3.75rem] px-1">
          <Link
            href="/admin/journal"
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${
              onJournal ? "text-gray-900 font-semibold" : "text-gray-500"
            }`}
          >
            <span className={`h-1 w-6 rounded-full ${onJournal ? "bg-gray-900" : "bg-transparent"}`} />
            Журнал
          </Link>
          <Link
            href="/admin/journal/schedule"
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${
              pathname.startsWith("/admin/journal/schedule") ? "text-gray-900 font-semibold" : "text-gray-500"
            }`}
          >
            <span
              className={`h-1 w-6 rounded-full ${
                pathname.startsWith("/admin/journal/schedule") ? "bg-gray-900" : "bg-transparent"
              }`}
            />
            Графік
          </Link>
          <button
            type="button"
            className="flex flex-col items-center justify-center gap-0.5 text-[11px] text-gray-500"
            onClick={() => setCalendarOpen(true)}
          >
            <span className="h-1 w-6 rounded-full bg-transparent" />
            Календар
          </button>
          <button
            type="button"
            className="flex items-center justify-center"
            onClick={() => {
              if (sidebarActions.onBook) {
                if (!onJournal) router.push("/admin/journal");
                sidebarActions.onBook();
                return;
              }
              router.push("/admin/journal?book=1");
            }}
          >
            <span className="inline-flex items-center justify-center h-9 px-4 rounded-full bg-neutral text-neutral-content text-[13px] font-semibold shadow-sm">
              Записати
            </span>
          </button>
        </div>
      </nav>

      {calendarOpen ? (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40 flex items-end"
          onClick={() => setCalendarOpen(false)}
        >
          <div
            className="w-full bg-[#f6f7fb] rounded-t-3xl px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" />
            <p className="px-1 pb-2 text-sm font-semibold tracking-tight">Оберіть день</p>
            <JournalSidebarCalendar touch onPicked={() => setCalendarOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function ChromeShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-gray-900 flex">
      <SidebarInner />
      <div className="flex-1 min-w-0 flex flex-col pb-[calc(3.75rem+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </div>
      <MobileDock />
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
