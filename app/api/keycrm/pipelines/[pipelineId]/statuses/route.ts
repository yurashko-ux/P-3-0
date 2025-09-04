type Ctx = { params: { pipelineId: string } };

export async function GET(_req: Request, ctx: Ctx) {
  const { pipelineId } = ctx.params;
  const base = process.env.KEYCRM_API_URL?.replace(/\/+$/, '') || '';
  const token = process.env.KEYCRM_BEARER || process.env.KEYCRM_TOKEN || '';

  if (base && token) {
    try {
      const r = await fetch(`${base}/pipelines/${encodeURIComponent(pipelineId)}/statuses`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
      const t = await r.text();
      let j:any = null; try { j = t ? JSON.parse(t) : null; } catch {}
      if (!r.ok) throw new Error(j?.message || t || r.statusText);
      const data = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
      return Response.json({ data });
    } catch (e:any) {
      return Response.json({ ok:false, error: e?.message || 'fetch_failed', data: [] }, { status: 502 });
    }
  }

  const demo: Record<string, {id:string,title:string}[]> = {
    '1': [{ id: '1-10', title: 'Новий' }, { id: '1-20', title: 'В роботі' }, { id: '1-30', title: 'Успішно' }],
    '2': [{ id: '2-10', title: 'Wait' }, { id: '2-20', title: 'Process' }, { id: '2-30', title: 'Done' }],
    '3': [{ id: '3-10', title: 'A' }, { id: '3-20', title: 'B' }, { id: '3-30', title: 'C' }]
  };
  return Response.json({ data: demo[pipelineId] || [] });
}
