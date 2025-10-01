// web/app/(admin)/admin/campaigns/page.tsx

export const dynamic = 'force-dynamic'; // забороняємо SSG для цієї сторінки

import ClientList from './ClientList';

export default function Page() {
  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Кампанії</h1>

        <div className="flex gap-2">
          <a
            href="/admin/campaigns/new"
            className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700"
          >
            + Нова кампанія
          </a>
          {/* Оновити — без onClick у Server Component */}
          <a
            href="/admin/campaigns"
            className="rounded border px-3 py-1.5 hover:bg-slate-50"
          >
            Оновити
          </a>
        </div>
      </div>

      {/* Увесь інтерактив і запити робить клієнтський компонент */}
      <ClientList />
    </div>
  );
}
