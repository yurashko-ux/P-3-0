"use client";

import { useEffect, useMemo, useState } from "react";

type Pipeline = { id: number; title: string };
type Status = { id: number; title: string; pipeline_id: number };

type Rule = {
  value: string;
  to_pipeline_id: number;
  to_status_id: number;
  to_pipeline_label?: string;
  to_status_label?: string;
};

type Campaign = {
  id?: string;
  createdAt?: string | number;

  base_pipeline_id: number;
  base_status_id: number;
  base_pipeline_label?: string;
  base_status_label?: string;

  rule1?: Rule;
  rule2?: Rule;

  expire_days?: number;
  expire_to?: Omit<Rule, "value">;
};

function buildAuthHeaders(extra?: HeadersInit): HeadersInit {
  let login = "", pass = "";
  try { login = localStorage.getItem("ADMIN_LOGIN") || ""; pass = localStorage.getItem("ADMIN_PASS") || ""; } catch {}
  const headers: Record<string, string> = { ...(extra ? Object.fromEntries(new Headers(extra)) : {}) };
  if (login && pass) headers["Authorization"] = "Basic " + btoa(`${login}:${pass}`);
  return headers;
}
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init, headers: buildAuthHeaders(init?.headers) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
const fmt = (v?: string | number) => {
  if (!v) return "—";
  const d = new Date(typeof v === "string" ? v : Number(v));
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

export default function CampaignsPage() {
  // Auth box
  const [adminLogin, setAdminLogin] = useState(""); const [adminPass, setAdminPass] = useState(""); const [authSaved, setAuthSaved] = useState(false);
  useEffect(()=>{ try{ setAdminLogin(localStorage.getItem("ADMIN_LOGIN")||""); setAdminPass(localStorage.getItem("ADMIN_PASS")||""); }catch{} },[]);
  function saveAuth(e?: React.FormEvent){ e?.preventDefault(); try{ localStorage.setItem("ADMIN_LOGIN", adminLogin.trim()); localStorage.setItem("ADMIN_PASS", adminPass); setAuthSaved(true); setTimeout(()=>setAuthSaved(false),1500);}catch{} }

  // Data
  const [pipelines,setPipelines]=useState<Pipeline[]>([]);
  const [statuses,setStatuses]=useState<Status[]>([]);
  const statusesByPipeline=useMemo(()=>{const m=new Map<number,Status[]>(); for(const s of statuses){const a=m.get(s.pipeline_id)??[]; a.push(s); m.set(s.pipeline_id,a);} return m;},[statuses]);

  const pipeLabel=(id:number|"")=>id===""?"":pipelines.find(p=>p.id===id)?.title??String(id);
  const statusLabel=(pid:number|"",sid:number|"")=>pid===""||sid===""?String(sid):(statusesByPipeline.get(Number(pid))?.find(s=>s.id===sid)?.title??String(sid));

  const [items,setItems]=useState<Campaign[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [flash,setFlash]=useState(false);

  // SCOPE
  const [basePipe,setBasePipe]=useState<number|"">("");
  const [baseStatus,setBaseStatus]=useState<number|"">("");

  // Rules
  const [var1,setVar1]=useState("1");
  const [v1Pipe,setV1Pipe]=useState<number|"">("");
  const [v1Status,setV1Status]=useState<number|"">("");

  const [var2,setVar2]=useState("2");
  const [v2Pipe,setV2Pipe]=useState<number|"">("");
  const [v2Status,setV2Status]=useState<number|"">("");

  const [expDays,setExpDays]=useState("3");
  const [expPipe,setExpPipe]=useState<number|"">("");
  const [expStatus,setExpStatus]=useState<number|"">("");

  // Load pipelines, statuses (per pipeline), saved campaigns
  useEffect(()=>{(async()=>{
    setLoading(true);
    try{
      const pl=await j<any>("/api/keycrm/pipelines").catch(()=>({data:[]}));
      const pp:Pipeline[]=(pl?.data||pl?.items||[]).map((p:any)=>({id:Number(p.id??p.pipeline_id??p.value??p?.pipeline?.id),title:String(p.title??p.name??p.label??p?.pipeline?.title)})).filter(p=>Number.isFinite(p.id));
      setPipelines(pp);

      const statusesArrays=await Promise.all(pp.map(p=>j<any>(`/api/keycrm/pipelines/${p.id}/statuses`).catch(()=>({data:[]}))));
      const ss:Status[]=statusesArrays.flatMap((res,idx)=>{
        const pid=pp[idx]?.id; const arr=(res?.data||res?.items||[]) as any[];
        return arr.map(s=>({id:Number(s.id), title:String(s.title??s.name??s.label), pipeline_id:Number(pid)}))
                  .filter(s=>Number.isFinite(s.id)&&Number.isFinite(s.pipeline_id));
      });
      setStatuses(ss);

      const list=await j<any>("/api/campaigns");
      setItems(Array.isArray(list?.items)?list.items:[]);
    }finally{setLoading(false);}
  })()},[]);

  const canSave =
    Number.isFinite(Number(basePipe)) &&
    Number.isFinite(Number(baseStatus)) &&
    (
      (v1Pipe && v1Status && var1.trim()!=="") ||
      (v2Pipe && v2Status && var2.trim()!=="") ||
      (expDays && (expPipe && expStatus))
    );

  function buildPayload(): Campaign {
    return {
      base_pipeline_id: Number(basePipe),
      base_status_id: Number(baseStatus),
      base_pipeline_label: pipeLabel(basePipe),
      base_status_label: statusLabel(basePipe, baseStatus),

      rule1: v1Pipe && v1Status && var1.trim()
        ? { value: var1.trim(), to_pipeline_id: Number(v1Pipe), to_status_id: Number(v1Status),
            to_pipeline_label: pipeLabel(v1Pipe), to_status_label: statusLabel(v1Pipe, v1Status) }
        : undefined,

      rule2: v2Pipe && v2Status && var2.trim()
        ? { value: var2.trim(), to_pipeline_id: Number(v2Pipe), to_status_id: Number(v2Status),
            to_pipeline_label: pipeLabel(v2Pipe), to_status_label: statusLabel(v2Pipe, v2Status) }
        : undefined,

      expire_days: expDays ? Number(expDays) : undefined,
      expire_to: expPipe && expStatus
        ? { to_pipeline_id: Number(expPipe), to_status_id: Number(expStatus),
            to_pipeline_label: pipeLabel(expPipe), to_status_label: statusLabel(expPipe, expStatus) }
        : undefined,
    };
  }

  async function handleSave(e: React.FormEvent){
    e.preventDefault(); if(!canSave) return;
    setSaving(true);
    try{
      await j("/api/campaigns",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(buildPayload())});
      const list=await j<any>("/api/campaigns");
      setItems(Array.isArray(list?.items)?list.items:[]);
      setFlash(true); setTimeout(()=>setFlash(false),1500);
    }finally{setSaving(false);}
  }

  async function removeCampaign(id?:string){
    if(!id) return; if(!confirm("Видалити кампанію?")) return;
    await j(`/api/campaigns/${id}`,{method:"DELETE"}).catch(()=>{});
    const list=await j<any>("/api/campaigns"); setItems(Array.isArray(list?.items)?list.items:[]);
  }

  const scopeText = (c: Campaign) =>
    `[Base: ${c.base_pipeline_label ?? c.base_pipeline_id} / ${c.base_status_label ?? c.base_status_id}]`;

  const rulesText = (c: Campaign) => {
    const parts:string[]=[];
    if(c.rule1) parts.push(`1: "${c.rule1.value}" → ${c.rule1.to_pipeline_label ?? c.rule1.to_pipeline_id} / ${c.rule1.to_status_label ?? c.rule1.to_status_id}`);
    if(c.rule2) parts.push(`2: "${c.rule2.value}" → ${c.rule2.to_pipeline_label ?? c.rule2.to_pipeline_id} / ${c.rule2.to_status_label ?? c.rule2.to_status_id}`);
    if(c.expire_days!=null || c.expire_to)
      parts.push(`expire ${c.expire_days ?? "—"}d → ${c.expire_to?.to_pipeline_label ?? c.expire_to?.to_pipeline_id ?? "—"} / ${c.expire_to?.to_status_label ?? c.expire_to?.to_status_id ?? "—"}`);
    return parts.join("; ");
  };

  return (
    <div className="space-y-16">
      {/* Auth card */}
      <section className="card">
        <div className="admin-nav__inner" style={{padding:0}}>
          <form onSubmit={saveAuth} className="form-grid" style={{gridTemplateColumns:"2fr 2fr 1fr"}}>
            <div><label className="label">Логін</label><input className="input" value={adminLogin} onChange={(e)=>setAdminLogin(e.target.value)} /></div>
            <div><label className="label">Пароль</label><input className="input" type="password" value={adminPass} onChange={(e)=>setAdminPass(e.target.value)} /></div>
            <div style={{alignSelf:"end"}}><button className="btn-primary" type="submit">Зберегти</button>{authSaved&&<span className="muted" style={{marginLeft:8}}>Збережено ✅</span>}</div>
          </form>
          <code className="muted">Campaigns</code>
        </div>
      </section>

      {/* Form */}
      <section className="card">
        <h1 className="h1">Campaigns Admin</h1>
        {flash && <p className="lead" style={{color:"#059669"}}>Збережено ✅</p>}

        <form onSubmit={handleSave} className="form-grid">
          {/* Scope */}
          <div>
            <label className="label">Базова воронка</label>
            <select className="select" value={basePipe} onChange={(e)=>{const v=e.target.value?Number(e.target.value):""; setBasePipe(v); setBaseStatus("");}}>
              <option value="">—</option>
              {pipelines.map(p=><option key={`b-${p.id}`} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Базовий статус</label>
            <select className="select" value={baseStatus} onChange={(e)=>setBaseStatus(e.target.value?Number(e.target.value):"")}>
              <option value="">—</option>
              {Number.isFinite(basePipe) && (statusesByPipeline.get(Number(basePipe))||[]).map(s=><option key={`b-s-${s.id}`} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          <div /> {/* заповнюємо третю колонку */}

          {/* Rule 1 */}
          <div>
            <label className="label">Змінна №1 (значення з Manychat)</label>
            <input className="input" value={var1} onChange={(e)=>setVar1(e.target.value)} />
          </div>
          <div>
            <label className="label">Воронка №1</label>
            <select className="select" value={v1Pipe} onChange={(e)=>{const v=e.target.value?Number(e.target.value):""; setV1Pipe(v); setV1Status("");}}>
              <option value="">—</option>
              {pipelines.map(p=><option key={`1-${p.id}`} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Статус</label>
            <select className="select" value={v1Status} onChange={(e)=>setV1Status(e.target.value?Number(e.target.value):"")}>
              <option value="">—</option>
              {Number.isFinite(v1Pipe) && (statusesByPipeline.get(Number(v1Pipe))||[]).map(s=><option key={`1-s-${s.id}`} value={s.id}>{s.title}</option>)}
            </select>
          </div>

          {/* Rule 2 */}
          <div>
            <label className="label">Змінна №2 (значення з Manychat)</label>
            <input className="input" value={var2} onChange={(e)=>setVar2(e.target.value)} />
          </div>
          <div>
            <label className="label">Воронка №2</label>
            <select className="select" value={v2Pipe} onChange={(e)=>{const v=e.target.value?Number(e.target.value):""; setV2Pipe(v); setV2Status("");}}>
              <option value="">—</option>
              {pipelines.map(p=><option key={`2-${p.id}`} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Статус</label>
            <select className="select" value={v2Status} onChange={(e)=>setV2Status(e.target.value?Number(e.target.value):"")}>
              <option value="">—</option>
              {Number.isFinite(v2Pipe) && (statusesByPipeline.get(Number(v2Pipe))||[]).map(s=><option key={`2-s-${s.id}`} value={s.id}>{s.title}</option>)}
            </select>
          </div>

          {/* Expire */}
          <div>
            <label className="label">Днів без відповіді</label>
            <input className="input" value={expDays} onChange={(e)=>setExpDays(e.target.value)} />
          </div>
          <div>
            <label className="label">Воронка (немає відповіді)</label>
            <select className="select" value={expPipe} onChange={(e)=>{const v=e.target.value?Number(e.target.value):""; setExpPipe(v); setExpStatus("");}}>
              <option value="">—</option>
              {pipelines.map(p=><option key={`e-${p.id}`} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Статус</label>
            <select className="select" value={expStatus} onChange={(e)=>setExpStatus(e.target.value?Number(e.target.value):"")}>
              <option value="">—</option>
              {Number.isFinite(expPipe) && (statusesByPipeline.get(Number(expPipe))||[]).map(s=><option key={`e-s-${s.id}`} value={s.id}>{s.title}</option>)}
            </select>
          </div>

          <div style={{gridColumn:"1 / -1"}}>
            <button type="submit" className="btn-primary" disabled={!canSave || saving}>
              {saving ? "Зберігаю…" : "Зберегти кампанію"}
            </button>
          </div>
        </form>
      </section>

      {/* List */}
      <section className="card">
        <table className="table">
          <thead><tr><th>Створено</th><th>Умови</th><th>Expires</th><th className="actions">Дії</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4}>Завантаження…</td></tr>
            ) : items.length===0 ? (
              <tr><td colSpan={4}>Немає збережених кампаній</td></tr>
            ) : items.map((c,i)=>(
              <tr key={c.id ?? i}>
                <td>{fmt(c.createdAt)}</td>
                <td>
                  <div>{`[Base: ${c.base_pipeline_label ?? c.base_pipeline_id} / ${c.base_status_label ?? c.base_status_id}]`}</div>
                  <div className="muted">{[
                    c.rule1 ? `1: "${c.rule1.value}" → ${c.rule1.to_pipeline_label ?? c.rule1.to_pipeline_id} / ${c.rule1.to_status_label ?? c.rule1.to_status_id}` : null,
                    c.rule2 ? `2: "${c.rule2.value}" → ${c.rule2.to_pipeline_label ?? c.rule2.to_pipeline_id} / ${c.rule2.to_status_label ?? c.rule2.to_status_id}` : null,
                    (c.expire_days!=null || c.expire_to) ? `expire ${c.expire_days ?? "—"}d → ${c.expire_to?.to_pipeline_label ?? c.expire_to?.to_pipeline_id ?? "—"} / ${c.expire_to?.to_status_label ?? c.expire_to?.to_status_id ?? "—"}` : null
                  ].filter(Boolean).join("; ")}</div>
                </td>
                <td>{c.expire_days!=null ? `${c.expire_days}d` : "—"}</td>
                <td className="actions">
                  {c.id && <button onClick={()=>removeCampaign(c.id!)} className="btn-link" style={{color:"#dc2626"}}>Видалити</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
