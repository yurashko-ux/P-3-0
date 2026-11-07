"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navTileClass } from "@/app/admin/_components/nav-tile";

type Permissions = Record<string, string>;

export const FINANCE_HEADER_ACTIONS_ID = "finance-header-actions";

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
  const showOperations =
    permissions == null ||
    permissions.financeOperationsSection !== "none" ||
    permissions.financeDocsSection !== "none";
  const showReport = permissions == null || permissions.financeReportSection !== "none";
  const showCash =
    permissions == null ||
    permissions.cashSection !== "none" ||
    permissions.financeDocsSection !== "none";

  const onDocs = pathname === "/admin/finance" || pathname === "/admin/finance/";
  const onPayments = pathname?.startsWith("/admin/finance/payments");
  const onRecords = pathname?.startsWith("/admin/finance/records");
  const onOperations = pathname?.startsWith("/admin/finance/operations");
  const onArchive = pathname?.startsWith("/admin/finance/archive");
  const onCash = pathname?.startsWith("/admin/finance/cash");

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-gray-900">
      <header className="sticky top-[var(--admin-nav-h,0px)] z-20 bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2">
        <h1 className="text-base font-bold mr-1">Фінанси</h1>
        {showDocs && (
          <Link
            href="/admin/finance"
            className={navTileClass(Boolean(onDocs))}
          >
            Документи
          </Link>
        )}
        {showDocs && (
          <Link
            href="/admin/finance/payments"
            className={navTileClass(Boolean(onPayments))}
          >
            Фінансові операції
          </Link>
        )}
        {showDocs && (
          <Link
            href="/admin/finance/records"
            className={navTileClass(Boolean(onRecords))}
          >
            Записи
          </Link>
        )}
        {showOperations && (
          <Link
            href="/admin/finance/operations"
            className={navTileClass(Boolean(onOperations))}
          >
            Операції лідів
          </Link>
        )}
        {showDocs && (
          <Link
            href="/admin/finance/archive"
            className={navTileClass(Boolean(onArchive))}
          >
            Архів Altegio
          </Link>
        )}
        {showReport && (
          <Link
            href="/admin/finance-report"
            className={navTileClass(false)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Звіт
          </Link>
        )}
        {showCash && (
          <Link href="/admin/finance/cash" className={navTileClass(Boolean(onCash))}>
            Каса
          </Link>
        )}
        {/* Сюди сторінка може поставити свою кнопку */}
        <div id={FINANCE_HEADER_ACTIONS_ID} className="contents" />
      </header>
      {children}
    </div>
  );
}
