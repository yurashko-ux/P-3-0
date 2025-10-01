// app/(admin)/admin/campaigns/page.tsx
import { headers } from 'next/headers';
import ClientList, { ApiList } from './ClientList';

export default async function CampaignsPage() {
  // Можна спробувати зробити SSR-фетч, але це не обов’язково,
  // бо ClientList сам зробить клієнтський запит і намалює актуальний список.
  // Тож даємо безпечний стартовий стан.
  const initial: ApiList = { ok: true, items: [], count: 0 };

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Кампанії</h1>
        <div className="flex gap-2">
          <a
            href="/admin/campaigns/new"
            className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            + Нова кампанія
          </a>
          <a
            href="/admin/campaigns"
            className="rounded-md bg-gray-100 px-4 py-2 hover:bg-gray-200"
          >
            Оновити
          </a>
        </div>
      </div>

      <div className="w-full overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="px-4 py-3 w-[220px]">Дата/ID</th>
              <th className="px-4 py-3 w-[260px]">Назва</th>
              <th className="px-4 py-3 w-[260px]">Сутність</th>
              <th className="px-4 py-3 w-[220px]">Воронка</th>
              <th className="px-4 py-3 w-[220px]">Лічильник</th>
              <th className="px-4 py-3 w-[140px]">Дії</th>
            </tr>
          </thead>

          {/* Рядки таблиці рендерить клієнтський компонент.
              Він же зробить fetch('/api/campaigns') і намалює дані. */}
          <ClientList initial={initial} />
        </table>
      </div>
    </div>
  );
}
