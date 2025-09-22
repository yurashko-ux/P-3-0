// web/app/admin/campaigns/page.tsx
// Список кампаній з блоком V2 + коректні назви pipeline/status у V1 та EXP

export const dynamic = "force-dynamic";

type Campaign = {
  id?: string | number;
  name?: string;
  created_at?: number;

  // base
  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;

  // V1
  v1_pipeline_id?: number;
  v1_status_id?: number;
  v1_pipeline_name?: string | null;
  v1_status_name?: string | null;

  // V2
  v2_pipeline_id?: number;
  v2_status_id?: number;
  v2_pipeline_name?: string | null;
  v2_status_name?: string | null;

  // EXP
  exp?: {
    to_pipeline_id?: number | null;
    to_status_id?: number | null;
    to_pipeline_name?: string | null;
    to_status_name?: string | null;
    days?: number | null;
  };

  // counters
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  active?: boolean;
};

function fmtDate(ts?: number) {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleString("uk-UA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-4 py-2 rounded-xl bg-blue-600 text-white">
      {children ?? "—"}
    </span>
  );
}

function Pair({
  pipeName,
  pipeId,
  statusName,
  statusId,
}: {
  pipeName?: string | null;
  pipeId?: number | string;
  statusName?: string | null;
  statusId?: number | string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Pill>{pipeName ?? pipeId ?? "—"}</Pill>
      <Pill>{statusName ?? statusId ?? "—"}</Pill>
    </div>
  );
}

async function getCampaigns(): Promise<Campaign[]> {
  // завжди свіже
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/campaigns`, {
    cache: "no-store",
  }).catch(() => null as any);

  if (!res || !res.ok) return [];
  const json = (await res.json().catch(() => ({}))) as { items?: Campaign[] };
  return Array.isArray(json.items) ? json.items : [];
}

export default async function Page() {
  const items = await getCampaigns();

  return (
    <div className="px-6 py-8">
      <div className="text-4xl font-extrabold mb-6">Кампанії</div>

      <div className="grid grid-cols-12 text-gray-700 font-semibold mb-3">
        <div className="col-span-3">Дата</div>
        <div className="col-span-2">Назва</div>
        <div className="col-span-2">Сутність</div>
        <div className="col-span-3">Воронка</div>
        <div className="col-span-1">Лічильник</div>
        <div className="col-span-1">Дії</div>
      </div>

      {items.length === 0 ? (
        <div className="w-full border rounded-2xl text-center py-20 text-2xl text-gray-500">
          Кампаній поки немає
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {items.map((c) => {
            const v1cnt = Number.isFinite(c.v1_count) ? Number(c.v1_count) : 0;
            const v2cnt = Number.isFinite(c.v2_count) ? Number(c.v2_count) : 0;
            const expcnt = Number.isFinite(c.exp_count) ? Number(c.exp_count) : 0;
            const expDays =
              typeof c.exp?.days === "number" && c.exp?.days! > 0
                ? `${c.exp?.days} днів`
                : "—";

            return (
              <div key={`${c.id ?? Math.random()}`} className="border rounded-2xl p-5">
                {/* BASE */}
                <div className="grid grid-cols-12 items-center gap-y-3">
                  <div className="col-span-3 text-gray-600">{fmtDate(c.created_at)}</div>
                  <div className="col-span-2 font-semibold">{c.name ?? "—"}</div>
                  <div className="col-span-2">База</div>
                  <div className="col-span-3">
                    <Pair
                      pipeName={c.base_pipeline_name}
                      pipeId={c.base_pipeline_id}
                      statusName={c.base_status_name}
                      statusId={c.base_status_id}
                    />
                  </div>
                  <div className="col-span-1 text-center">—</div>
                  <div className="col-span-1 flex gap-4">
                    <a className="text-blue-600" href={`/admin/campaigns/${c.id}/edit`}>
                      Edit
                    </a>
                    <a className="text-red-600" href={`/admin/campaigns/${c.id}/delete`}>
                      Delete
                    </a>
                  </div>

                  {/* V1 */}
                  <div className="col-span-3" />
                  <div className="col-span-2" />
                  <div className="col-span-2">V1</div>
                  <div className="col-span-3">
                    <Pair
                      pipeName={c.v1_pipeline_name}
                      pipeId={c.v1_pipeline_id}
                      statusName={c.v1_status_name}
                      statusId={c.v1_status_id}
                    />
                  </div>
                  <div className="col-span-1 text-center">{v1cnt}</div>
                  <div className="col-span-1" />

                  {/* V2 (ДОДАНО) */}
                  <div className="col-span-3" />
                  <div className="col-span-2" />
                  <div className="col-span-2">V2</div>
                  <div className="col-span-3">
                    <Pair
                      pipeName={c.v2_pipeline_name}
                      pipeId={c.v2_pipeline_id}
                      statusName={c.v2_status_name}
                      statusId={c.v2_status_id}
                    />
                  </div>
                  <div className="col-span-1 text-center">{v2cnt}</div>
                  <div className="col-span-1" />

                  {/* EXP */}
                  <div className="col-span-3" />
                  <div className="col-span-2" />
                  <div className="col-span-2">EXP</div>
                  <div className="col-span-3">
                    <Pair
                      pipeName={c.exp?.to_pipeline_name ?? null}
                      pipeId={c.exp?.to_pipeline_id ?? undefined}
                      statusName={c.exp?.to_status_name ?? null}
                      statusId={c.exp?.to_status_id ?? undefined}
                    />
                  </div>
                  <div className="col-span-1 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span>{expcnt}</span>
                      <span className="text-gray-500">{expDays}</span>
                    </div>
                  </div>
                  <div className="col-span-1" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
