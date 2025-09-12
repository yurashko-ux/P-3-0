// --- kcGetCardState: повертає поточний стан картки з KV --------------------
/**
 * Повертає стан картки з локального KV-індексу, який ми наповнюємо під час sync.
 * Використання:
 *   const state = await kcGetCardState(435);
 *   if (state.ok) { state.card.pipeline_id, state.card.status_id ... }
 */
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
    // Динамічний імпорт, щоб не ламати існуючі імпорти зверху файлу:
    const { kvGet } = await import('@/lib/kv');
    const key = `kc:card:${id}`;
    const card = await kvGet(key);

    if (card) {
      // Мінімальна перевірка форми
      return { ok: true, source: 'kv', card };
    }
    return { ok: false, source: 'none', reason: 'not_found_in_kv' };
  } catch (e: any) {
    return { ok: false, source: 'error', error: e?.message ?? 'unknown' };
  }
}
// ---------------------------------------------------------------------------
