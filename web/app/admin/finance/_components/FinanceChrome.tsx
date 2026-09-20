"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function FinanceChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onDocs = pathname === "/admin/finance" || pathname === "/admin/finance/";
  const onPayments = pathname?.startsWith("/admin/finance/payments");

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-gray-900">
      <header className="sticky top-0 z-20 bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2">
        <h1 className="text-base font-bold mr-1">Фінанси</h1>
        <Link
          href="/admin/finance"
          className={`btn btn-sm min-h-0 h-8 ${onDocs ? "btn-neutral" : "btn-ghost"}`}
        >
          Документи
        </Link>
        <Link
          href="/admin/finance/payments"
          className={`btn btn-sm min-h-0 h-8 ${onPayments ? "btn-neutral" : "btn-ghost"}`}
        >
          Оплати візитів
        </Link>
        <Link
          href="/admin/finance-report"
          className="btn btn-ghost btn-sm min-h-0 h-8"
          target="_blank"
          rel="noopener noreferrer"
        >
          Звіт
        </Link>
        <div className="flex-1" />
        <Link href="/admin/bank" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
          Банк
        </Link>
        <Link href="/admin/warehouse" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
          Склад
        </Link>
        <Link href="/admin/direct" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
          Direct
        </Link>
      </header>
      {children}
    </div>
  );
}
