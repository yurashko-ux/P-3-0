'use client';

import { useEffect, useState } from 'react';

export default function EditSavedCampaign({ params }: { params: { id: string } }) {
  const { id } = params;
  const [value, setValue] = useState<string>('{}');
  const [msg, setMsg] = useState<string| null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/campaigns/${id}`);
      if (r.ok) {
        const j = await r.json();
        setValue(JSON.stringify(j, null, 2));
      } else setValue('{}');
    })();
  }, [id]);

  async function save() {
    try {
      const body = JSON.parse(value);
      const r = await fetch(`/api/campaigns/${id}`, {
        method: 'PUT', headers: { 'content-type':'application/json' }, body: JSON.stringify(body)
      });
      if (r.ok) setMsg('Збережено ✅'); else setMsg('Не вдалося зберегти');
    } catch { setMsg('JSON помилковий'); }
  }

  return (
    <main data-admin className="admin-shell">
      <h1>Редагування кампанії</h1>
      {msg && <p>{msg}</p>}
      <div className="card">
        <textarea style={{width:'100%', minHeight:300}} value={value} onChange={(e)=>setValue(e.target.value)} />
        <div style={{marginTop:12}}>
          <button className="btn" onClick={save}>Зберегти</button>
          <a className="btn" style={{marginLeft:8}} href="/campaigns/saved">Назад до списку</a>
        </div>
      </div>
    </main>
  );
}
