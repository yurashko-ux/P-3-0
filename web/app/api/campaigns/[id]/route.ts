// web/app/api/campaigns/[id]/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

async function getIdsArray(): Promise<string[]> {
  const arr = await kv.get<string[] | null>(IDS_KEY);
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}
async function setIdsArray(ids: string[]) {
  await kv.set(IDS_KEY, ids);
}

async function deleteById(id: string) {
  await kv.del(ITEM_KEY(id));
  const ids = await getIdsArray();
  const next = ids.filter((x) => x !== id);
  await setIdsArray(next);
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
