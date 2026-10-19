"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Permissions = Record<string, string>;

export function FinanceChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [permissions, setPermissions] = useState<Permissions | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.ok && data.permissions) setPermissions(data.permissions);
        else if (!cancelled) setPermissions({});
      })
      .catch(() => {
        if (!cancelled) setPermissions({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showDocs =
    permissions == null ||
    permissions.financeDocsSection !== "none" ||
    permissions.financeReportSection !== "none";
  const showCash =
    permissions == null ||
    permissions.cashSection !== "none" ||
    permissions.financeDocsSection !== "none";
  const showOperations =
    permissions == null ||
    permissions.financeOperationsSection !== "none" ||
    permissions.financeDocsSection !== "none";
  const showReport = permissions == null || permissions.financeReportSection !== "none";
  const showBank = permissions == null || permissions.bankSection !== "none";
  const showWarehouse = permissions == null || permissions.warehouseSection !== "none";

  const onDocs = pathname === "/admin/finance" || pathname === "/admin/finance/";
  const onKasa = pathname?.startsWith("/admin/finance/kasa") || pathname?.startsWith("/admin/finance/cash");
  const onPayments = pathname?.startsWith("/admin/finance/payments");
  const onRecords = pathname?.startsWith("/admin/finance/records");
  const onOperations = pathname?.startsWith("/admin/finance/operations");
  const onArchive = pathname?.startsWith("/admin/finance/archive");

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-gray-900">
      <header className="sticky top-0 z-20 bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2">
        <h1 className="text-base font-bold mr-1">Фінанси</h1>
        {showDocs && (
          <Link
            href="/admin/finance"
            className={`btn btn-sm min-h-0 h-8 ${onDocs ? "btn-neutral" : "btn-ghost"}`}
          >
            Документи
          </Link>
        )}
        {showCash && (
          <Link
            href="/admin/finance/kasa"
            className={`btn btn-sm min-h-0 h-8 ${onKasa ? "btn-neutral" : "btn-ghost"}`}
          >
            Каса
          </Link>
        )}
        {showDocs && (
          <Link
            href="/admin/finance/payments"
            className={`btn btn-sm min-h-0 h-8 ${onPayments ? "btn-neutral" : "btn-ghost"}`}
          >
            Фінансові операції
          </Link>
        )}
        {showDocs && (
          <Link
            href="/admin/finance/records"
            className={`btn btn-sm min-h-0 h-8 ${onRecords ? "btn-neutral" : "btn-ghost"}`}
          >
            Записи
          </Link>
        )}
        {showOperations && (
          <Link
            href="/admin/finance/operations"
            className={`btn btn-sm min-h-0 h-8 ${onOperations ? "btn-neutral" : "btn-ghost"}`}
          >
            Операції лідів
          </Link>
        )}
        {showDocs && (
          <Link
            href="/admin/finance/archive"
            className={`btn btn-sm min-h-0 h-8 ${onArchive ? "btn-neutral" : "btn-ghost"}`}
          >
            Архів Altegio
          </Link>
        )}
        {showReport && (
          <Link
            href="/admin/finance-report"
            className="btn btn-ghost btn-sm min-h-0 h-8"
            target="_blank"
            rel="noopener noreferrer"
          >
            Звіт
          </Link>
        )}
        <div className="flex-1" />
        {showBank && (
          <Link href="/admin/bank" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
            Банк
          </Link>
        )}
        {showWarehouse && (
          <Link href="/admin/warehouse" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
            Склад
          </Link>
        )}
        <Link href="/admin/direct" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
          Direct
        </Link>
      </header>
      {children}
    </div>
  );
}
