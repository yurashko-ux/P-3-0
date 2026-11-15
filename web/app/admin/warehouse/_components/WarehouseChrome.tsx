"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { navTileClass } from "@/app/admin/_components/nav-tile";
import { WarehouseNav } from "./WarehouseNav";

type WarehouseSearchCtx = {
  searchDraft: string;
  setSearchDraft: (value: string) => void;
};

const WarehouseSearchContext = createContext<WarehouseSearchCtx | null>(null);

/** Сюди сторінка Складу може поставити свої кнопки (як у панелі Фінансів). */
export const WAREHOUSE_HEADER_ACTIONS_ID = "warehouse-header-actions";

export function useWarehouseSearch() {
  const ctx = useContext(WarehouseSearchContext);
  if (!ctx) {
    throw new Error("useWarehouseSearch має бути всередині WarehouseChrome");
  }
  return ctx;
}

export function WarehouseChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [searchDraft, setSearchDraft] = useState("");
  const isLeftovers = pathname === "/admin/warehouse";
  const value = useMemo(() => ({ searchDraft, setSearchDraft }), [searchDraft]);

  return (
    <WarehouseSearchContext.Provider value={value}>
      <div className="min-h-screen bg-[#f6f7fb] text-gray-900">
        <header className="sticky top-[var(--admin-nav-h,0px)] z-20 h-[3.25rem] bg-white border-b px-3 flex items-center gap-2 overflow-x-auto">
          <h1 className="text-base font-bold mr-1 shrink-0">Склад</h1>
          <WarehouseNav />
          <div id={WAREHOUSE_HEADER_ACTIONS_ID} className="contents" />
          {isLeftovers && (
            <input
              type="search"
              className="h-7 min-w-[160px] max-w-xs flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] focus:border-blue-300 focus:outline-none"
              placeholder="Пошук: код, назва…"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              aria-label="Пошук залишків"
            />
          )}
          <div className="flex-1" />
          <Link href="/admin/finance-report" className={navTileClass(false)}>
            Фінансовий звіт
          </Link>
        </header>
        <div id="warehouse-filter-dropdown-root" />
        {children}
      </div>
    </WarehouseSearchContext.Provider>
  );
}
