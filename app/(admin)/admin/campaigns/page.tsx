// /app/(admin)/admin/campaigns/page.tsx
import ClientList, { type ApiList } from './ClientList';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function fetchInitial(): Promise<ApiList> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL;
    const url = base ? `${base}/api/campaigns` : '/api/campaigns';
    const res = await fetch(url, { cache: 'no-store', next: { revalidate: 0 } });
    const json = (await res.json()) as ApiList;
    return json;
  } catch {
    return { ok: false, items: [], error: 'fetch failed' };
  }
}

export default async function Page() {
  const initial = await fetchInitial();

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Кампанії</h1>
        <div className="flex gap-3">
          <form action="/api/campaigns/seed" method="post">
            <button className="rounded bg-slate-200 px-3 py-1.5 hover:bg-slate-300" type="submit">
              Seed 1
            </button>
          </form>
          <a
            href="/admin/campaigns"
            className="rounded bg-slate-200 px-3 py-1.5 hover:bg-slate-300"
          >
            Оновити
          </a>
        </div>
      </div>

      <div className="overflow-x-auto rounded border">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="p-3">Дата/ID</th>
              <th className="p-3">Назва</th>
              <th className="p-3">Сутність</th>
              <th className="p-3">Воронка</th>
              <th className="p-3">Лічильник</th>
              <th className="p-3">Дії</th>
            </tr>
          </thead>
          <tbody>
            <ClientList initial={initial} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
