"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/journal", label: "Календар", exact: true },
  { href: "/admin/journal/services", label: "Послуги" },
  { href: "/admin/journal/staff", label: "Працівники" },
];

export function JournalNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1">
      {LINKS.map((link) => {
        const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`btn btn-sm min-h-0 h-8 ${active ? "btn-neutral" : "btn-ghost"}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function JournalChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-gray-900">
      <header className="sticky top-0 z-20 bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2">
        <h1 className="text-base font-bold mr-1">Журнал</h1>
        <JournalNav />
        <div className="flex-1" />
        <Link href="/admin/direct" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">Direct</Link>
        <Link href="/admin/team" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">Команда</Link>
        <Link href="/admin/finance" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">Фінанси</Link>
        <Link href="/admin/warehouse" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">Склад</Link>
        <Link href="/book" className="btn btn-ghost min-h-0 h-8 py-0 text-xs" target="_blank" rel="noopener noreferrer">
          Онлайн-запис
        </Link>
      </header>
      {children}
    </div>
  );
}
