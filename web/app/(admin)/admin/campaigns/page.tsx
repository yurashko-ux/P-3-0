// web/app/(admin)/admin/campaigns/page.tsx
import Link from 'next/link';
import ClientList from './ClientList';

export default async function CampaignsPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Кампанії</h1>
        <Link
          href="/admin/campaigns/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-white shadow hover:bg-blue-700"
        >
          + Нова кампанія
        </Link>
      </div>

      {/* Клієнтський список: робить запит до /api/campaigns та показує дані */}
      <ClientList />
    </div>
  );
}
