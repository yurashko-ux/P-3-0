import Link from "next/link";
import { WarehouseNav } from "./_components/WarehouseNav";

export default function WarehouseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-gray-900">
      <header className="sticky top-0 z-20 bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2">
        <h1 className="text-base font-bold mr-1">Склад</h1>
        <WarehouseNav />
        <div className="flex-1" />
        <Link href="/admin/direct" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
          Direct
        </Link>
        <Link href="/admin/finance-report" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
          Фінансовий звіт
        </Link>
      </header>
      {children}
    </div>
  );
}
