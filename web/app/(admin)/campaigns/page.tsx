async function load() {
  setLoading(true);
  setError(null);
  try {
    const t = readCookie('admin_token') || '';
    setToken(t);

    // передаємо токен і в заголовку, і в query як фолбек
    const url = t ? `/api/campaigns?token=${encodeURIComponent(t)}` : `/api/campaigns`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-Admin-Token': t || '' },
      cache: 'no-store',
      credentials: 'same-origin',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text || 'Failed to load campaigns'}`);
    }
    const json = await res.json();
    if (!json?.ok) throw new Error(json?.error || 'Unknown API error');
    setItems(json.items || []);
  } catch (e: any) {
    setError(e?.message || String(e));
    setItems([]);
  } finally {
    setLoading(false);
  }
}
