// web/app/admin/campaigns/page.tsx
// Server-only: читаємо з KV і відмалюємо охайний список із бейджами та зрозумілими сутностями.

import { kvGet, kvZrevrange } from "../../../lib/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Condition =
  | { field: "text" | "flow" | "tag" | "any"; op: "contains" | "equals"; value: string }
  | null;

type Campaign = {
  id: string;
  created_at: string;
  name: string;
  base_pipeline_id: string;
  base_status_id: string;
  v1_condition: Condition;
  v1_to_pipeline_id: string | null;
  v1_to_status_id: string | null;
  v2_condition: Condition;
  v2_to_pipeline_id: string | null;
  v2_to_status_id: string | null;
  exp_days: number;
  exp_to_pipeline_id: string | null;
  exp_to_status_id: string | null;
  note?: string | null;
  enabled: boolean;
  v1_count: number;
  v2_count: number;
  exp_count: number;
};

// ——— UI helpers ———
function Badge(props: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={props.title}
      className={
        "inline-flex items-center rounded-xl border px-2 py-0.5 text-[12px] leading-5 " +
        "border-gray-200 bg-gray-50 text-slate-700 " +
        (props.className ?? "")
      }
    >
      {props.children}
    </span>
  );
}
function Pill(props: { children: React.ReactNode; color?: "green" | "red" | "slate" }) {
  const map: Record<string, string> = {
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
  };
  return <Badge className={map[props.color ?? "slate"]}>{props.children}</Badge>;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("uk-UA");
  } catch {
    return iso;
  }
}
function fmtId(x: string | null) {
  return x ? String(x) : "—";
}
function condToText(c: Condition): string {
  if (!c) return "—";
  if (c.field === "any") return "будь-що";
  const op = c.op === "equals" ? "дорівнює" : "містить";
  return `${c.field} ${op} «${c.value}»`;
}

function VariantRow({
  label,
  cond,
  toP,
  toS,
  accent,
}: {
  label: string;
  cond: Condition;
  toP: string | null;
  toS: string | null;
  accent: "blue" | "violet" | "amber";
}) {
  const accentCls =
    accent === "blue"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : accent === "violet"
      ? "bg-violet-50 text-violet-700 border-violet-200"
      : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge className={accentCls}>
        {label}
      </Badge>
      <span className="text-slate-500 text-sm">{condToText(cond)}</span>
      <span className="text-slate-400">→</span>
      <Badge>{fmtId(toP)}/{fmtId(toS)}</Badge>
    </div>
  );
}

// ——— Data ———
async function loadCampaigns(): Promise<Campaign[]> {
  const ids = await kvZrevrange("campaigns:index", 0, 199);
  const rows = await Promise.all(ids.map((id) => kvGet<Campaign>(`campaigns:${id}`)));
  return (rows.filter(Boolean) as Campaign[]);
}

export default async function CampaignsPage() {
  let items: Campaign[] = [];
  let error: string | null = null;

  try {
    items = await loadCampaigns();
  } catch (e: any) {
    error = e?.message ?? "load failed";
  }

  return (
    <main className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Кампанії</h1>
        <a
          href="/admin/campaigns/new"
          className="px-4 py-2 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
        >
          Нова кампанія
        </a>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-red-700">
          <b>Помилка завантаження:</b> {error}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 p-10 text-center bg-white">
          <p className="text-slate-600">Поки що немає жодної кампанії.</p>
          <a
            href="/admin/campaigns/new"
            className="mt-4 inline-flex px-4 py-2 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white"
          >
            Створити першу
          </a>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-slate-700">
              <tr className="text-left">
                <th className="p-3 w-[200px]">Дата</th>
                <th className="p-3 w-[220px]">Назва</th>
                <th className="p-3">Сутність</th>
                <th className="p-3 w-[90px]">Статус</th>
                <th className="p-3 w-[160px]">Лічильники</th>
                <th className="p-3 w-[120px]">Дії</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t align-top hover:bg-gray-50">
                  <td className="p-3 text-slate-600">{fmtDate(c.created_at)}</td>
                  <td className="p-3">
                    <div className="font-medium text-slate-900">{c.name || "Без назви"}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge className="bg-slate-50">
                        база
                      </Badge>
                      <Badge title="Base pipeline/status">
                        {fmtId(c.base_pipeline_id)}/{fmtId(c.base_status_id)}
                      </Badge>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="space-y-1.5">
                      <VariantRow
                        label="v1"
                        cond={c.v1_condition}
                        toP={c.v1_to_pipeline_id}
                        toS={c.v1_to_status_id}
                        accent="blue"
                      />
                      <VariantRow
                        label="v2"
                        cond={c.v2_condition}
                        toP={c.v2_to_pipeline_id}
                        toS={c.v2_to_status_id}
                        accent="violet"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-amber-50 text-amber-700 border-amber-200">exp</Badge>
                        <span className="text-slate-500 text-sm">
                          через <b>{c.exp_days}</b> д.
                        </span>
                        <span className="text-slate-400">→</span>
                        <Badge>{fmtId(c.exp_to_pipeline_id)}/{fmtId(c.exp_to_status_id)}</Badge>
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    {c.enabled ? (
                      <Pill color="green">ON</Pill>
                    ) : (
                      <Pill color="red">OFF</Pill>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <Pill color="slate">v1: {c.v1_count}</Pill>
                      <Pill color="slate">v2: {c.v2_count}</Pill>
                      <Pill color="slate">exp: {c.exp_count}</Pill>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <a
                        className="px-3 py-1 rounded-xl border border-gray-300 hover:bg-gray-100"
                        href={`/admin/campaigns/${c.id}/edit`}
                      >
                        Edit
                      </a>
                      {/* TODO: Delete */}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
