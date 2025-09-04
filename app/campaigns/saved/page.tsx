'use client';

import { useEffect, useState } from 'react';

type Campaign = {
  id: string;
  createdAt: string;
  fromPipelineId: string;
  fromStatusId: string;
  toPipelineId: string;
  toStatusId: string;
  expiresDays?: number | null;
  title?: string;
};

export default function SavedCampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  async function load() {
    setErr(null); setLoading(true);
    try {
      const r = await fetch('/api/campaigns', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setItems(j.items || []);
    } catch (e:any) {
      setErr(`Помилка завантаження: ${e?.message||e}`);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function onDelete(id: string) {
    if (!confirm('Видалити кампанію?')) return;
    const r = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    if (r.ok) setItems((list) => list.filter((x) => x.id !== id));
  }

  async function onTest(id: string) {
    const username = prompt('Вкажи Instagram username для тесту:');
    if (!username) return;
    const r = await fetch('/api/mc/ingest', {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({ campaignId: id, username })
    });
    const j = await r.json().catch(() => ({}));
    alert(j?.ok ? 'Тест надіслано' : 'Не вдалося запустити тест');
  }

  return (
    <main data-admin className="admin-shell">
      <h1>Збережені кампанії</h1>

      {err && <p className="error-inline">{err}</p>}
      {loading && <p>Завантаження…</p>}

      <div className="card">
        <table className="cmp">
          <thead>
            <tr>
              <th>Створено</th>
              <th>Умови (з → в)</th>
              <th>Expires</th>
              <th style={{width:220}}>Дії</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={4} style={{textAlign:'center', color:'#64748b'}}>Немає збережених кампаній</td></tr>
            )}
            {items.map(c => (
              <tr key={c.id}>
                <td>{new Date(c.createdAt).toLocaleString()}</td>
                <td>
                  <div>
                    з <code>{c.fromPipelineId}</code>/<code>{c.fromStatusId}</code>
                    {' '}→ в <code>{c.toPipelineId}</code>/<code>{c.toStatusId}</code>
                  </div>
                </td>
                <td>{c.expiresDays ?? '—'}</td>
                <td>
                  <button className="btn" onClick={() => onTest(c.id)}>Тест</button>{' '}
                  <a className="btn" href={`/campaigns/saved/${c.id}`}>Редагувати</a>{' '}
                  <button className="btn" onClick={() => onDelete(c.id)}>Видалити</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .cmp { width:100%; border-collapse: collapse; }
        .cmp th, .cmp td { border-bottom:1px solid #e5e7eb; padding:10px 8px; vertical-align: top; }
        .cmp th { text-align:left; color:#334155; font-weight:700; }
        .btn{padding:8px 12px;border-radius:10px;border:1px solid #e5e7eb;background:#fff;cursor:pointer}
        .btn:hover{background:#f3f4f6}
      `}</style>
    </main>
  );
}
