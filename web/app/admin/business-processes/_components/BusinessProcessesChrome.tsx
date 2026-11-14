// Шапка розділу — як у Фінансах: назва і плитки; сторінка ставить свої кнопки в BP_HEADER_ACTIONS_ID.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navTileClass } from "@/app/admin/_components/nav-tile";

export const BP_HEADER_ACTIONS_ID = "business-processes-header-actions";

export function BusinessProcessesChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onList = pathname === "/admin/business-processes" || pathname === "/admin/business-processes/";
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-gray-900">
      <header className="sticky top-[var(--admin-nav-h,0px)] z-20 bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2">
        <h1 className="text-base font-bold mr-1">Бізнес-процеси</h1>
        <Link href="/admin/business-processes" className={navTileClass(onList)}>
          Процеси
        </Link>
        <div id={BP_HEADER_ACTIONS_ID} className="contents" />
      </header>
      {children}
    </div>
  );
}
