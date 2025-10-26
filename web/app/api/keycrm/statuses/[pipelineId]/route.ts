// web/app/api/keycrm/statuses/[pipelineId]/route.ts
import { NextResponse } from "next/server";
import { authHeaders, baseUrl, maskAuth } from "../../_common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickAnyArray(payload: any): any[] {
  if (!payload) return [];
  const tryPaths: (string | string[])[] = [
    "data", "items", "statuses", "result", "list",
    ["data","data"], ["data","items"], ["payload","data"], ["payload","items"]
  ];
  for (const p of tryPaths) {
    if (Array.isArray(p)) {
      let node: any = payload;
      for (const key of p) node = node?.[key];
      if (Array.isArray(node)) return node;
    } else {
      const arr = payload?.[p];
      if (Array.isArray(arr)) return arr;
    }
  }
  if (Array.isArray(payload)) return payload;
  return [];
}

export async function GET(
  _req: Request,
  { params }: { params: { pipelineId: string } }
) {
  const pid = encodeURIComponent(params.pipelineId);
  const url = `${baseUrl()}/pipelines/${pid}/statuses?per_page=200`;
  try {
    const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
    const ct = res.headers.get("content-type") || "";
    const payload = ct.includes("application/json") ? await res.json().catch(() => null) : null;

    if (res.ok) {
      const rawArr = pickAnyArray(payload);
      const out = rawArr
        .map((s: any) => {
          const pipelineStatusSource =
            s?.pivot?.pipeline_status_id ??
            s?.pipeline_status_id ??
            s?.pipelineStatusId ??
            null;

          const statusSource =
            s?.status_id ??
            s?.status?.id ??
            s?.statusId ??
            s?.pivot?.status_id ??
            null;

          const fallback = s?.id ?? s?.uuid ?? null;

          const pipelineStatusId =
            pipelineStatusSource != null && pipelineStatusSource !== ''
              ? String(pipelineStatusSource)
              : null;

          const statusId =
            statusSource != null && statusSource !== '' ? String(statusSource) : null;

          const primary = pipelineStatusId ?? statusId ?? (fallback != null ? String(fallback) : null);
          const id = primary != null ? String(primary) : '';
          if (!id) return null;

          const name = String(
            s?.name ?? s?.title ?? s?.label ?? s?.slug ?? s?.id ?? s?.uuid ?? `Статус #${id}`,
          );

          return {
            id,
            name,
            pipelineStatusId,
            statusId,
          };
        })
        .filter((value): value is { id: string; name: string; pipelineStatusId: string | null; statusId: string | null } =>
          Boolean(value?.id),
        );

      if (out.length > 0) {
        return NextResponse.json({ ok: true, data: out }, { status: 200 });
      }
      return NextResponse.json({
        ok: true,
        data: [],
        diag: {
          note: "Не знайшов масив statuses у відомих полях. Ось форма відповіді.",
          jsonKeys: payload ? Object.keys(payload) : [],
          rawPreview: payload ? JSON.stringify(payload).slice(0, 800) : null,
        }
      }, { status: 200 });
    }

    return NextResponse.json(
      {
        ok: false,
        status: res.status,
        reason: (payload && (payload.message || payload.error)) || "KeyCRM error",
        url,
        authPreview: maskAuth(authHeaders().Authorization),
      },
      { status: res.status }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e), url },
      { status: 502 }
    );
  }
}
