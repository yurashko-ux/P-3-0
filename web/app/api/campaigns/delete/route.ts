// app/api/campaigns/delete/route.ts
import { NextResponse } from 'next/server';
import { kvWrite } from '@/lib/kv'; // тут твій існуючий хелпер роботи з KV

/** Простий хелпер редіректу назад на список */
function backToList(message?: string) {
  const url = new URL('/admin/campaigns', process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost');
  if (message) url.searchParams.set('msg', message);
  return NextResponse.redirect(url, { status: 303 });
}

/** Видалення через POST з форми */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const id = (form.get('id') || '').toString().trim();

    if (!id) {
      return backToList('missing-id');
    }

    // ⚙️ ВАЖЛИВО: викликаємо ваш запис у KV, що реально видаляє кампанію.
    // Якщо у вас інша назва — підстав тут свою (наприклад kvWrite.deleteCampaign).
    // Нижче — два універсальні кроки: soft-delete по ключу + видалення з індексу.

    await kvWrite.setRaw(`campaign:${id}`, JSON.stringify({ deleted: true }));
    await kvWrite.lpush('campaign:index:deleted', id); // або свій механізм
    // якщо в тебе є окрема функція:
    // await kvWrite.deleteCampaign(id)

    return backToList('deleted');
  } catch (e) {
    console.error('POST /api/campaigns/delete failed', e);
    return backToList('error');
  }
}
