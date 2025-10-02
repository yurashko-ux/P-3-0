// web/app/api/campaigns/[id]/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

async function deleteById(id: string) {
  const tx = kv.multi();
  tx.lrem(IDS_KEY, 0, id);
  tx.del(ITEM_KEY(id));
  await tx.exec();
  return { ok: true, id };
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const res = await deleteById(params.id);
  return NextResponse.json(res);
}

// Allow HTML forms to POST with _method=DELETE
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
    } else if (
      ct.includes("application/x-www-form-urlencoded") ||
      ct.includes("multipart/form-data")
    ) {
      const fd = await req.formData();
      method = String(fd.get("_method") || "");
    }
  } catch {
    // ignore parse errors
  }

  if (method.toUpperCase() !== "DELETE") {
    return NextResponse.json(
      { error: "Unsupported POST. Use _method=DELETE." },
      { status: 405 }
    );
  }

  const res = await deleteById(params.id);
  return NextResponse.json(res);
}
