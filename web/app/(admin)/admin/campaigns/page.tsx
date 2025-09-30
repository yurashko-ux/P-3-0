import { headers } from 'next/headers';
import ClientList from './ClientList';

type Counters = { v1?: number; v2?: number; exp?: number };
type BaseInfo = { pipeline?: string; status?: string; pipelineName?: string; statusName?: string };
type Campaign = {
  id: string;
  name?: string;
  v1?: { value?: string };
  v2?: { value?: string };
  base?: BaseInfo;
  counters?: Counters;
  createdAt?: string | number | Date;
  deleted?: boolean;
};
type ApiList = { ok: boolean; items?: Campaign[]; count?: number };

async function getInitial(): Promise<ApiList> {
  try {
    const h = headers();
    const proto = h.get('x-forwarded-proto') || 'https';
    const host =
      h.get('host') ||
      process.env.VERCEL_URL ||
      process.env.NEXT_PUBLIC_VERCEL_URL ||
      'localhost:3000';
    const base = `${proto}://${host}`;
    const r = await fetch(`${base}/api/campaigns`, { cache: 'no-store' });
    if (r.ok) return (await r.json()) as ApiList;
  } catch {
    // ignore and fall back
  }
  return { ok: true, items: [], count: 0 };
}

export default async function CampaignsPage() {
  const initial = await getInitial();

  return (
    <div className="w-full">
      {/* Клієнтський список: отримує стартові дані з сервера */}
      <ClientList initial={initial} />
    </div>
  );
}
