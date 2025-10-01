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
          <button
            onClick={() => location.reload()}
            className="rounded border px-3 py-1.5 hover:bg-slate-50"
          >
            Оновити
          </button>
        </div>
      </div>

      {/* ClientList сам завантажує дані з /api/campaigns, пропси не потрібні */}
      <ClientList />
    </div>
  );
}
