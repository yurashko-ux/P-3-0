// web/app/(admin)/admin/campaigns/page.tsx
export const dynamic = 'force-dynamic';

import ClientList from './ClientList';

export default async function CampaignsPage() {
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Кампанії</h1>
        <div className="flex gap-2">
          <a
            href="/admin/campaigns/new"
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            + Нова кампанія
          </a>
          <a
            href="/admin/campaigns"
            className="rounded border px-4 py-2 hover:bg-gray-50"
          >
            Оновити
          </a>
        </div>
      </div>

      <div className="overflow-x-auto rounded border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Дата/ID</th>
              <th className="px-3 py-2 text-left">Назва</th>
              <th className="px-3 py-2 text-left">Сутність</th>
              <th className="px-3 py-2 text-left">Воронка</th>
              <th className="px-3 py-2 text-left">Лічильник</th>
              <th className="px-3 py-2 text-left">Дії</th>
            </tr>
          </thead>

          {/* Рендер клієнтом (робить fetch до /api/campaigns) */}
          <ClientList />
        </table>
      </div>
    </div>
  );
}
