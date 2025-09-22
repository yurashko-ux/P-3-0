// web/app/(admin)/campaigns/page.tsx
import { NextResponse } from "next/server";

type Any = any;

type Campaign = {
  id?: string | number;
  name?: string;
  created_at?: number;

  // базова пара
  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;

  // V1
  rules?: {
    v1?: { value?: string; op?: "contains" | "equals" };
    v2?: { value?: string; op?: "contains" | "equals" };
  };
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
    // дні експерименту (може бути відсутнім)
    days?: number | null;
  };

  // лічильники (можуть бути відсутні)
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  active?: boolean;
};

function fmtDate(ts?: number) {
  if (!ts) return "-";
  try {
    const d = new Date(ts);
    return d.toLocaleString("uk-UA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

function Pair({
  label,
  pipeName,
  pipeId,
  statusName,
  statusId,
}: {
  label: string;
  pipeName?: string | null;
  pipeId?: number | string;
  statusName?: string | null;
  statusId?: number | string;
}) {
  const pipe = pipeName ?? (pipeId ?? "—");
  const stat = statusName ?? (statusId ?? "—");
  return (
    <div className="flex items-center gap-3">
      <div className="text-base font-semibold text-gray-800">{label}</div>
      <div className="px-4 py-2 rounded-xl bg-blue-600 text-white">
        {pipe}
      </div>
      <div className="px-4 py-2 rounded-xl bg-blue-600 text-white">
        {stat}
      </div>
    </div>
  );
}

async function fetchCampaigns(): Promise<Campaign[]> {
  // серверний fetch, щоб завжди тягнути свіже
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/campaigns`, {
    cache: "no-store",
  }).catch(() => null as Any);

  if (!res || !res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { items?: Campaign[] };
  return Array.isArray(data?.items) ? data.items : [];
}

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const items = await fetchCampaigns();

  return (
    <div className="px-6 py-8">
      <div className="text-4xl font-extrabold mb-6">Кампанії</div>

      <div className="grid grid-cols-12 text-gray-700 font-semibold mb-3">
        <div className="col-span-2">Дата</div>
        <div className="col-span-2">Назва</div>
        <div className="col-span-2">Сутність</div>
        <div className="col-span-3">Воронка</div>
        <div className="col-span-1">Тригер</div>
        <div className="col-span-1">Стан</div>
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
              <div
                key={`${c.id ?? Math.random()}`}
                className="border rounded-2xl p-5"
              >
                {/* шапка рядка */}
                <div className="grid grid-cols-12 items-center mb-4">
                  <div className="col-span-2 text-gray-600">
                    {fmtDate(c.created_at)}
                  </div>
                  <div className="col-span-2 font-semibold">{c.name ?? "—"}</div>

                  {/* БАЗА */}
                  <div className="col-span-8">
                    <div className="flex flex-wrap gap-5 items-center">
                      <Pair
                        label="База"
                        pipeName={c.base_pipeline_name}
                        pipeId={c.base_pipeline_id}
                        statusName={c.base_status_name}
                        statusId={c.base_status_id}
                      />
                      <div className="text-gray-500">—</div>
                      <div className="text-gray-500">—</div>
                      <div className="text-gray-800">no</div>
                      <div className="flex gap-4">
                        <a className="text-blue-600" href={`/admin/campaigns/${c.id}/edit`}>
                          Edit
                        </a>
                        <a className="text-red-600" href={`/admin/campaigns/${c.id}/delete`}>
                          Delete
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                {/* V1 */}
                <div className="grid grid-cols-12 items-center mb-2">
                  <div className="col-span-2" />
                  <div className="col-span-2" />
                  <div className="col-span-2 text-gray-700 font-semibold">V1</div>
                  <div className="col-span-3">
                    <Pair
                      label=""
                      pipeName={c.v1_pipeline_name}
                      pipeId={c.v1_pipeline_id}
                      statusName={c.v1_status_name}
                      statusId={c.v1_status_id}
                    />
                  </div>
                  <div className="col-span-1 text-center">{v1cnt}</div>
                  <div className="col-span-1 text-gray-800">{c.active ? "yes" : "no"}</div>
                </div>

                {/* V2 */}
                <div className="grid grid-cols-12 items-center mb-2">
                  <div className="col-span-2" />
                  <div className="col-span-2" />
                  <div className="col-span-2 text-gray-700 font-semibold">V2</div>
                  <div className="col-span-3">
                    <Pair
                      label=""
                      pipeName={c.v2_pipeline_name}
                      pipeId={c.v2_pipeline_id}
                      statusName={c.v2_status_name}
                      statusId={c.v2_status_id}
                    />
                  </div>
                  <div className="col-span-1 text-center">{v2cnt}</div>
                  <div className="col-span-1 text-gray-800">—</div>
                </div>

                {/* EXP */}
                <div className="grid grid-cols-12 items-center">
                  <div className="col-span-2" />
                  <div className="col-span-2" />
                  <div className="col-span-2 text-gray-700 font-semibold">EXP</div>
                  <div className="col-span-3">
                    <Pair
                      label=""
                      pipeName={c.exp?.to_pipeline_name ?? null}
                      pipeId={c.exp?.to_pipeline_id ?? undefined}
                      statusName={c.exp?.to_status_name ?? null}
                      statusId={c.exp?.to_status_id ?? undefined}
                    />
                  </div>
                  <div className="col-span-1 text-center">{expcnt}</div>
                  <div className="col-span-1 text-gray-800">{expDays}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
