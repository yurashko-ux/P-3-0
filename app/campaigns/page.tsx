'use client';

import { useEffect, useMemo, useState } from 'react';

type Pipeline = { id: string; title: string };
type Status = { id: string; title: string };
type Row = { value: string; pipelineId: string; statusId: string; };

export default function CampaignsPage() {
  const [login, setLogin] = useState('admin');
  const [pass, setPass]   = useState('');
  const [msg, setMsg]     = useState<string | null>(null);
  const [err, setErr]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [statusesByPipe, setStatusesByPipe] = useState<Record<string, Status[]>>({});

  const [rows, setRows] = useState<Row[]>([
    { value: '', pipelineId: '', statusId: '' },
    { value: '', pipelineId: '', statusId: '' },
    { value: '', pipelineId: '', statusId: '' },
  ]);

  useEffect(() => {
    const p = localStorage.getItem('admin_pass') || '';
    if (p) setPass(p);
  }, []);

  async function fetchPipelines() {
    setErr(null); setMsg(null); setLoading(true);
    try {
      const r = await fetch('/api/keycrm/pipelines');
      if (!r.ok) throw new Error(`${r.status} /api/keycrm/pipelines`);
      const j = await r.json();
      const list = Array.isArray(j?.data) ? j.data : j;
      setPipelines(list.map((x: any) => ({ id: String(x.id), title: String(x.title || x.name || x.id) })));
      setMsg(`Підтягнуто воронки: ${list.length}`);
    } catch (e: any) {
      setErr(`Помилка: ${e?.message || e}`);
    } finally { setLoading(false); }
  }

  async function fetchStatuses(pipeId: string) {
    if (!pipeId || statusesByPipe[pipeId]) return;
    try {
      const r = await fetch(`/api/keycrm/pipelines/${encodeURIComponent(pipeId)}/statuses`);
      if (!r.ok) throw new Error(`${r.status} /api/keycrm/pipelines/${pipeId}/statuses`);
      const j = await r.json();
      const list = (Array.isArray(j?.data) ? j.data : j).map((x: any) => ({ id: String(x.id), title: String(x.title || x.name || x.id) }));
      setStatusesByPipe((m) => ({ ...m, [pipeId]: list }));
    } catch (e: any) {
      setErr(`Помилка: ${e?.message || e}`);
    }
  }

  function setRow(idx: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function onSave() {
    setErr(null); setMsg(null); setLoading(true);
    try {
      const payload = { choices: rows.map((r, i) => ({ index: i + 1, value: r.value, pipeline_id: r.pipelineId || null, status_id: r.statusId || null })) };
      const r = await fetch('/api/admin/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error(`${r.status} /api/admin/config`);
      setMsg('Збережено ✅');
      localStorage.setItem('admin_config', JSON.stringify(payload));
    } catch (e: any) {
      setErr(`Не вдалося зберегти (${e?.message || e})`);
    } finally { setLoading(false); }
  }

  function onReset() {
    setRows([
      { value: '', pipelineId: '', statusId: '' },
      { value: '', pipelineId: '', statusId: '' },
      { value: '', pipelineId: '', statusId: '' },
    ]);
    setErr(null); setMsg(null);
  }

  const tabs = useMemo(() => ([
    { id: 'pull', label: 'Підтягнути воронки', onClick: fetchPipelines, kind: 'primary' as const },
    { id: 'settings', label: 'Налаштування', onClick: () => {}, kind: 'tab' as const },
    { id: 'campaigns', label: 'Кампанії', onClick: () => {}, kind: 'tab' as const, active: true },
  ]), []);

  return (
    <div className="page">
      <h1>Campaigns Admin</h1>

      <section className="card">
        <div className="grid grid-2">
          <div>
            <label>Логін</label>
            <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="admin" />
          </div>
          <div>
            <label>Пароль</label>
            <input type="password" value={pass} onChange={(e) => { setPass(e.target.value); localStorage.setItem('admin_pass', e.target.value); }} placeholder="ADMIN_PASS" />
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 12 }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={t.onClick} className={t.kind === 'primary' ? 'btn btn-primary' : `btn btn-tab${t.active ? ' active' : ''}`} disabled={loading}>
              {t.label}
            </button>
          ))}
          {err ? <span className="error-inline"> {err}</span> : null}
          {msg ? <span className="ok-inline"> {msg}</span> : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Змінні пишемо прямо в рядках зі своїми воронками/статусами.</h2>

        <div className="rows">
          {[0,1,2].map((i) => {
            const row = rows[i];
            const pipeStatuses = row.pipelineId ? (statusesByPipe[row.pipelineId] || []) : [];
            return (
              <div key={i} className="row">
                <div className="col">
                  <div className="label">{i === 2 ? 'Змінна №3 — Expires (days), якщо немає відповіді' : `Змінна №${i+1} (значення з Manychat)`}</div>
                  <input placeholder={i===2 ? 'напр. 4' : `напр. ${i+1} або текст`} value={row.value} onChange={(e) => setRow(i, { value: e.target.value })} />
                </div>
                <div className="col">
                  <div className="label">{i === 2 ? 'Воронка (немає відповіді)' : `Воронка №${i+1}`}</div>
                  <div className="select-wrap">
                    <select value={row.pipelineId} onChange={(e) => { const id = e.target.value; setRow(i, { pipelineId: id, statusId: '' }); if (id) fetchStatuses(id); }}>
                      <option value="">— обрати —</option>
                      {pipelines.map((p) => (<option key={p.id} value={p.id}>{p.title}</option>))}
                    </select>
                    <span className="chev">▾</span>
                  </div>
                </div>
                <div className="col">
                  <div className="label">Статус</div>
                  <div className="select-wrap">
                    <select value={row.statusId} onChange={(e) => setRow(i, { statusId: e.target.value })} disabled={!row.pipelineId}>
                      <option value="">— 0 —</option>
                      {pipeStatuses.map((s) => (<option key={s.id} value={s.id}>{s.title}</option>))}
                    </select>
                    <span className="chev">▾</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" onClick={onSave} disabled={loading}>Зберегти</button>
          <button className="btn" onClick={onReset} disabled={loading}>Очистити</button>
        </div>
      </section>

      <style jsx>{`
        .page { max-width: 1100px; margin: 0 auto; padding: 16px; }
        h1 { font-size: 40px; line-height: 1.1; font-weight: 800; margin: 4px 0 18px; letter-spacing: -0.02em; }
        h2 { font-size: 20px; font-weight: 700; margin: 0 0 10px; }
        .grid { display: grid; gap: 12px; }
        .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        @media (max-width: 720px) { .grid-2 { grid-template-columns: 1fr; } }
        .label { color: #64748b; font-size: 13px; margin-bottom: 6px; }
        input, select { width: 100%; border: 1px solid #e5e7eb; border-radius: 12px; padding: 10px 12px; background: #fff; outline: none; }
        input:focus, select:focus { border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,.18); }
        .rows { display: flex; flex-direction: column; gap: 14px; }
        .row { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 12px; }
        @media (max-width: 900px) { .row { grid-template-columns: 1fr; } }
        .col { display: flex; flex-direction: column; }
        .select-wrap { position: relative; }
        .select-wrap select { appearance: none; padding-right: 34px; }
        .chev { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; color: #64748b; }
      `}</style>
    </div>
  );
}
