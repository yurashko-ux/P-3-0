export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return Response.json({ ok: true, received: body });
}
