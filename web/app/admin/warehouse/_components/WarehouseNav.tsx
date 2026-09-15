"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/warehouse", label: "Залишки", exact: true },
  { href: "/admin/warehouse/catalog", label: "Каталог" },
  { href: "/admin/warehouse/documents", label: "Документи" },
  { href: "/admin/warehouse/currencies", label: "Валюти" },
];

export function WarehouseNav() {
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
