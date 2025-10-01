// app/(admin)/admin/campaigns/page.tsx
import ClientCampaignsTable from './ClientCampaignsTable';

export const dynamic = 'force-dynamic'; // на випадок, якщо Next вирішить кешувати сторінку

export default function CampaignsPage() {
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Кампанії</h1>
        <div className="flex gap-2">
          <a
            href="/api/campaigns/seed"
            className="rounded bg-gray-200 px-3 py-1 hover:bg-gray-300"
            title="Створити тестові кампанії"
          >
            Seed API
          </a>
          <a
            href="/api/campaigns"
            className="rounded bg-gray-200 px-3 py-1 hover:bg-gray-300"
            title="Подивитися JSON з бекенда"
          >
            JSON API
          </a>
        </div>
      </div>

      <div className="overflow-x-auto rounded border">
        <table className="min-w-full text-left">
          <thead className="bg-gray-50">
            <tr className="text-gray-600">
              <th className="px-4 py-3 w-48">Дата/ID</th>
              <th className="px-4 py-3 w-64">Назва</th>
              <th className="px-4 py-3 w-64">Сутність</th>
              <th className="px-4 py-3 w-72">Воронка</th>
              <th className="px-4 py-3 w-64">Лічильник</th>
              <th className="px-4 py-3 w-40">Дії</th>
            </tr>
          </thead>
          <tbody>
            <ClientCampaignsTable />
          </tbody>
        </table>
      </div>
    </div>
  );
}
