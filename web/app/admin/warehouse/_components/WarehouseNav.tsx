"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navTileClass } from "@/app/admin/_components/nav-tile";

const LINKS = [
  { href: "/admin/warehouse", label: "Залишки", exact: true },
  { href: "/admin/warehouse/documents", label: "Документи" },
  { href: "/admin/warehouse/catalog", label: "Каталог товарів" },
  // Дані послуг — API Журналу (доступ за правами журналу).
  { href: "/admin/warehouse/services", label: "Каталог послуг" },
  { href: "/admin/warehouse/currencies", label: "Валюти" },
];

export function WarehouseNav() {
  const pathname = usePathname();
  return (
    <nav className="flex shrink-0 items-center gap-2">
      {LINKS.map((link) => {
        const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} className={navTileClass(active)}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
