// ВСТАВ ЦЕ В КІНЕЦЬ ROOT ФАЙЛУ: lib/keycrm.ts
// (не в web/lib/...)
// Експорт: kcGetCardState — читає стан картки з KV.

export async function kcGetCardState(cardId: string | number): Promise<{
  ok: boolean;
  source: 'kv' | 'none' | 'error';
  card?: {
    id: number;
    title?: string;
    pipeline_id?: number | null;
    status_id?: number | null;
    contact_social_name?: string | null;
    contact_social_id?: string | null;
    contact_full_name?: string | null;
    updated_at?: string;
  };
  reason?: string;
  error?: string;
}> {
  try {
    const id = String(cardId);
    // Динамічний імпорт, щоб не чіпати існуючі імпорти зверху файлу
    const { kvGet } = await import('@/lib/kv');
    const key = `kc:card:${id}`;
    const card = await kvGet(key);

    if (card) {
      return { ok: true, source: 'kv', card };
    }
    return { ok: false, source: 'none', reason: 'not_found_in_kv' };
  } catch (e: any) {
    return { ok: false, source: 'error', error: e?.message ?? 'unknown' };
  }
}
