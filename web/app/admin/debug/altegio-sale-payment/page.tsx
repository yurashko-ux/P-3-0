// web/app/admin/debug/altegio-sale-payment/page.tsx
import Link from "next/link";

import { AltegioSalePaymentTest } from "@/components/admin/altegio-sale-payment-test";

export const dynamic = "force-dynamic";

export default function AltegioSalePaymentTestPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin/debug" className="rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50">
            ← Тестова сторінка
          </Link>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Тест Altegio sale payment balance</h1>
        <p className="text-sm text-slate-500">
          Перевірка POST{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            /company/&#123;location_id&#125;/sale/&#123;document_id&#125;/payment
          </code>{" "}
          і поля <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">payment_methods[].balance</code> для колонки
          «Залишок в касі».
        </p>
        <p className="text-sm text-amber-800">
          Потрібен доступ до розділу Банк. Реальний POST створює оплату в Altegio — спочатку використовуйте dry run.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <AltegioSalePaymentTest />
      </section>
    </main>
  );
}
