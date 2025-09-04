export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // тут можна підключити реальний Manychat/інший сервіс
  return Response.json({ ok: true, received: body });
}
