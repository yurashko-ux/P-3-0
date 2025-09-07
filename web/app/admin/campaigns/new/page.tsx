// web/app/admin/campaigns/new/page.tsx
import CampaignForm from "../_components/CampaignForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function NewCampaignPage() {
  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Нова кампанія</h1>
        <a
          href="/admin/campaigns"
          className="px-4 py-2 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50"
        >
          До списку
        </a>
      </div>
      <CampaignForm />
    </main>
  );
}
