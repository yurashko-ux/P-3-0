import ClientCampaignsTable from './ClientCampaignsTable';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Кампанії</h1>
      <ClientCampaignsTable />
    </div>
  );
}
