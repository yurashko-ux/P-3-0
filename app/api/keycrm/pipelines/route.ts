export async function GET() {
  const base = process.env.KEYCRM_API_URL?.replace(/\/+$/, '') || '';
  const token = process.env.KEYCRM_BEARER || process.env.KEYCRM_TOKEN || '';

  if (base && token) {
    try {
      const r = await fetch(`${base}/pipelines`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
      const t = await r.text();
      let j:any = null; try { j = t ? JSON.parse(t) : null; } catch {}
      if (!r.ok) throw new Error(j?.message || t || r.statusText);
      const data = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
      return Response.json({ data });
    } catch (e:any) {
      return Response.json({ ok:false, error: e?.message || 'fetch_failed', data: [] }, { status: 502 });
    }
  }

  return Response.json({ data: [
    { id: '1', title: 'Воронка A' },
    { id: '2', title: 'Воронка B' },
    { id: '3', title: 'Воронка C' },
  ]});
}
