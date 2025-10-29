// web/app/admin/debug/page.tsx
// Server-rendered debug панель для огляду стану KV з кампаніями.

import { campaignKeys, kvRead } from '@/lib/kv';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function AdminDebugPage() {
  const envOk = Boolean(
    process.env.KV_REST_API_URL &&
      (process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN),
  );

  let indexIds: string[] = [];
  let recentCampaigns: any[] = [];
  let error: string | null = null;

  try {
    indexIds = await kvRead.lrange(campaignKeys.INDEX_KEY, 0, 19);
    const allCampaigns = await kvRead.listCampaigns();
    recentCampaigns = allCampaigns.slice(0, 10);
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Admin • Debug (KV)</h1>
        <p className="text-sm text-gray-500">
          Сторінка тільки для розробників. Показує стан Redis KV для кампаній.
        </p>
      </header>

      <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-medium">Стан середовища</h2>
        <div className="text-sm">
          <span className="font-semibold">KV env configured:</span> {envOk ? 'yes' : 'no'}
        </div>
        {error && (
          <div className="text-sm text-red-600">
            <span className="font-semibold">KV error:</span> {error}
          </div>
        )}
        {!error && (
          <div className="text-sm text-gray-500">
            Завантажено {indexIds.length} id у списку індексу.
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-medium">Останні campaign IDs ({campaignKeys.INDEX_KEY})</h2>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-gray-900 p-3 text-xs text-gray-100">
          {JSON.stringify(indexIds, null, 2)}
        </pre>
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-medium">Останні кампанії</h2>
        {recentCampaigns.length === 0 ? (
          <p className="text-sm text-gray-500">Немає збережених кампаній у KV.</p>
        ) : (
          <div className="space-y-4">
            {recentCampaigns.map((campaign) => (
              <article
                key={campaign.__index_id ?? campaign.id}
                className="space-y-2 rounded border border-gray-100 bg-gray-50 p-3"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-semibold">ID:</span>
                  <code>{campaign.id}</code>
                  {campaign.__index_id && campaign.__index_id !== campaign.id && (
                    <span className="text-gray-500">
                      (index id: <code>{campaign.__index_id}</code>)
                    </span>
                  )}
                  {campaign.created_at && (
                    <span className="text-gray-500">
                      {new Date(Number(campaign.created_at)).toLocaleString('uk-UA')}
                    </span>
                  )}
                </div>
                <div className="text-sm">
                  <span className="font-semibold">Назва:</span>{' '}
                  {campaign.name || <span className="text-gray-500">(без назви)</span>}
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-gray-900 p-3 text-xs text-gray-100">
                  {JSON.stringify(campaign, null, 2)}
                </pre>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
