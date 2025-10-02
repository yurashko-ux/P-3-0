// ...попередній код без змін...

// -------- GET /api/campaigns --------
export async function GET() {
  const ids = await getIdsArray();
  if (!ids.length) return NextResponse.json<Campaign[]>([]);
  const keys = ids.map(ITEM_KEY);
  const items = await kv.mget<(Campaign | null)[]>(...keys);
  const list = (items ?? []).filter(Boolean) as Campaign[];
  return NextResponse.json(list);
}

// ...далі без змін...
