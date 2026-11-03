"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/team", label: "Люди", exact: true },
  { href: "/admin/team/schemes", label: "Схеми ЗП" },
  { href: "/admin/team/payroll", label: "Нарахування ЗП" },
  { href: "/admin/team/archive", label: "Архів" },
];

export function TeamNav() {
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

export function TeamChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-gray-900">
      <header className="sticky top-[var(--admin-nav-h,0px)] z-20 bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2">
        <h1 className="text-base font-bold mr-1">Команда</h1>
        <TeamNav />
      </header>
      {children}
    </div>
  );
}
