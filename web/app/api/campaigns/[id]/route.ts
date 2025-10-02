// web/app/api/campaigns/[id]/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

// --- helpers (ідентичні логіці в /api/campaigns) ---
type IdsMode = "array" | "list" | "missing";
async function getIds(): Promise<{ ids: string[]; mode: IdsMode }> {
  const arr = await kv.get<string[] | null>(IDS_KEY);
  if (Array.isArray(arr)) return { ids: arr.filter(Boolean), mode: "array" };
  try {
    const list = await kv.lrange<string>(IDS_KEY, 0, -1);
    if (Array.isArray(list) && list.length > 0) {
      return { ids: list.filter(Boolean), mode: "list" };
    }
  } catch {}
  return { ids: [], mode: "missing" };
}
async function saveIdsAsArray(ids: string[]) {
  await kv.set(IDS_KEY, ids);
}
async function saveIds(ids: string[], _mode: IdsMode) {
  // Завжди повертаємося до канонічного формату — масив JSON
  await saveIdsAsArray(ids);
}

async function deleteById(id: string) {
  await kv.del(ITEM_KEY(id));
  const { ids } = await getIds();
  const next = ids.filter((x) => x !== id);
  await saveIds(next, "array");
  return { ok: true, id };
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const res = await deleteById(params.id);
  return NextResponse.json(res);
}

// Підтримка HTML-форми: POST + _method=DELETE
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  let method = "";
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      const body = await req.json();
      method = String(body?._method || "");
    } else {
      const fd = await req.formData();
      method = String(fd.get("_method") || "");
    }
  } catch {}
  if (method.toUpperCase() !== "DELETE") {
    return NextResponse.json(
      { error: "Unsupported POST. Use _method=DELETE." },
      { status: 405 }
    );
  }
  const res = await deleteById(params.id);
  return NextResponse.json(res);
}
