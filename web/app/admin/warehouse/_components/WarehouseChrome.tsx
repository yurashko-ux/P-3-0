"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { WarehouseNav } from "./WarehouseNav";

type WarehouseSearchCtx = {
  searchDraft: string;
  setSearchDraft: (value: string) => void;
};

const WarehouseSearchContext = createContext<WarehouseSearchCtx | null>(null);

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
        <header className="sticky top-0 z-20 bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2">
          <h1 className="text-base font-bold mr-1">Склад</h1>
          <WarehouseNav />
          {isLeftovers && (
            <input
              type="search"
              className="input input-sm input-bordered flex-1 min-w-[160px] max-w-md min-h-8 text-xs"
              placeholder="Пошук: код, назва…"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              aria-label="Пошук залишків"
            />
          )}
          <div className="flex-1" />
          <Link href="/admin/direct" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
            Direct
          </Link>
          <Link href="/admin/journal" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
            Журнал
          </Link>
          <Link href="/admin/team" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
            Команда
          </Link>
          <Link href="/admin/finance-report" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
            Фінансовий звіт
          </Link>
        </header>
        <div id="warehouse-filter-dropdown-root" />
        {children}
      </div>
    </WarehouseSearchContext.Provider>
  );
}
