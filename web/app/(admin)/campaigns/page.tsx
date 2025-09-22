"use client";

import { useEffect, useMemo, useState } from "react";

type Rule = { op?: "contains" | "equals"; value?: string };
type Campaign = {
  id: string;
  name?: string;

  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;

  rules?: { v1?: Rule; v2?: Rule };

  exp?: {
    to_pipeline_id?: number;
    to_status_id?: number;
    to_pipeline_name?: string | null;
    to_status_name?: string | null;
    trigger?: Rule;
  };

  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  created_at?: number;
  active?: boolean;
};

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(
    new RegExp("(?:^|;\\s*)" + name.replace(/[-.[\]{}()*+?^$|\\]/g, "\\$&") + "=([^;]*)")
  );
  return m ? decodeURIComponent(m[1]) : null;
}

export default function AdminCampaignsPage() {
  // --- admin token handling ---
  const [token, setToken] = useState<string>("");
  useEffect(() => {
    // 1) з cookie admin_token
    const fromCookie = readCookie("admin_token");
    // 2) з localStorage, якщо є
    const fromLS = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
    const t = (fromCookie || fromLS || "").trim();
    if (t) setToken(t);
  }, []);
  useEffect(() => {
    if (token && typeof window !== "undefined") {
      localStorage.setItem("admin_token", token);
      // дублюємо в cookie на 30 днів (для бека — якщо буде потрібно)
      document.cookie = `admin_token=${encodeURIComponent(token)}; Max-Age=${60 * 60 * 24 * 30}; Path=/; SameSite=Lax`;
    }
  }, [token]);

  // --- list campaigns ---
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/campaigns", { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Failed to load");
      setItems(j.items || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  // --- create form state ---
  const [name, setName] = useState("");
  const [basePipelineId, setBasePipelineId] = useState<string>("");
  const [baseStatusId, setBaseStatusId] = useState<string>("");

  const [v1Op, setV1Op] = useState<"contains" | "equals">("contains");
  const [v1Value, setV1Value] = useState("");

  const [v2Op, setV2Op] = useState<"contains" | "equals">("contains");
  const [v2Value, setV2Value] = useState("");

  const [expPipelineId, setExpPipelineId] = useState<string>("");
  const [expStatusId, setExpStatusId] = useState<string>("");
  const [expOp, setExpOp] = useState<"contains" | "equals">("contains");
  const [expValue, setExpValue] = useState("");

  const validToken = useMemo(() => (token || "").trim(), [token]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!validToken) {
      setError("Введи ADMIN_TOKEN нагорі (або постав cookie admin_token) і спробуй ще раз.");
      return;
    }

    const body: Partial<Campaign> = {
      name: name || "",
      base_pipeline_id: basePipelineId ? Number(basePipelineId) : undefined,
      base_status_id: baseStatusId ? Number(baseStatusId) : undefined,
      rules: {
        v1: { op: v1Op, value: v1Value || "" },
        v2: v2Value ? { op: v2Op, value: v2Value } : undefined,
      },
      exp:
        expPipelineId || expStatusId || expValue
          ? {
              to_pipeline_id: expPipelineId ? Number(expPipelineId) : undefined,
              to_status_id: expStatusId ? Number(expStatusId) : undefined,
              trigger: expValue ? { op: expOp, value: expValue } : undefined,
            }
          : undefined,
      active: true,
    };

    // головне: токен у query → бек приймає його
    const url = `/api/campaigns?token=${encodeURIComponent(validToken)}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // дублюємо в заголовок на всяк випадок (бек також приймає header)
      body: JSON.stringify(body),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      setError(`POST /api/campaigns → ${j?.error || r.statusText}`);
      return;
    }

    // очистити форму (не обов'язково)
    setName("");
    setBasePipelineId("");
    setBaseStatusId("");
    setV1Op("contains");
    setV1Value("");
    setV2Op("contains");
    setV2Value("");
    setExpPipelineId("");
    setExpStatusId("");
    setExpOp("contains");
    setExpValue("");

    await load();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Campaigns (admin)</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="border rounded px-2 py-1 text-sm w-[280px]"
            placeholder="ADMIN_TOKEN (збережеться в LocalStorage + Cookie)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <span className={`text-xs px-2 py-1 rounded ${validToken ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {validToken ? "token ✓" : "нема токена"}
          </span>
        </div>
      </div>

      {/* Create */}
      <form onSubmit={onCreate} className="border rounded-lg p-4 space-y-4">
        <h2 className="font-medium">Створити кампанію</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Name</span>
            <input className="border rounded px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Base pipeline id (V1)</span>
            <input className="border rounded px-2 py-1" value={basePipelineId} onChange={(e) => setBasePipelineId(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Base status id (V1)</span>
            <input className="border rounded px-2 py-1" value={baseStatusId} onChange={(e) => setBaseStatusId(e.target.value)} />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* V1 */}
          <div className="border rounded p-3 space-y-2">
            <div className="text-sm font-medium">Rule V1</div>
            <div className="flex gap-2">
              <select className="border rounded px-2 py-1" value={v1Op} onChange={(e) => setV1Op(e.target.value as any)}>
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </select>
              <input className="border rounded px-2 py-1 flex-1" placeholder="value..." value={v1Value} onChange={(e) => setV1Value(e.target.value)} />
            </div>
          </div>

          {/* V2 */}
          <div className="border rounded p-3 space-y-2">
            <div className="text-sm font-medium">Rule V2 (optional)</div>
            <div className="flex gap-2">
              <select className="border rounded px-2 py-1" value={v2Op} onChange={(e) => setV2Op(e.target.value as any)}>
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </select>
              <input className="border rounded px-2 py-1 flex-1" placeholder="value..." value={v2Value} onChange={(e) => setV2Value(e.target.value)} />
            </div>
          </div>
        </div>

        {/* EXP */}
        <div className="border rounded p-3 space-y-2">
          <div className="text-sm font-medium">EXP (optional)</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input className="border rounded px-2 py-1" placeholder="to_pipeline_id" value={expPipelineId} onChange={(e) => setExpPipelineId(e.target.value)} />
            <input className="border rounded px-2 py-1" placeholder="to_status_id" value={expStatusId} onChange={(e) => setExpStatusId(e.target.value)} />
            <div className="flex gap-2">
              <select className="border rounded px-2 py-1" value={expOp} onChange={(e) => setExpOp(e.target.value as any)}>
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </select>
              <input className="border rounded px-2 py-1 flex-1" placeholder="trigger value..." value={expValue} onChange={(e) => setExpValue(e.target.value)} />
            </div>
          </div>
        </div>

        <button type="submit" className="bg-black text-white px-4 py-2 rounded hover:opacity-90">
          Create
        </button>

        {error && <div className="text-red-600 text-sm">{error}</div>}
      </form>

      {/* List */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-medium">Список кампаній</h2>
          <button onClick={load} className="text-sm border px-2 py-1 rounded hover:bg-gray-50">Refresh</button>
        </div>

        {loading && <div className="text-sm text-gray-500">Loading…</div>}
        {!loading && items && items.length === 0 && <div className="text-sm text-gray-500">Порожньо</div>}

        {!loading && items && items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pb-2 pr-4">Created</th>
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Base (V1)</th>
                <th className="pb-2 pr-4">V1</th>
                <th className="pb-2 pr-4">V2</th>
                <th className="pb-2 pr-4">EXP</th>
                <th className="pb-2 pr-4">Counts</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="py-2 pr-4">{c.created_at ? new Date(c.created_at).toLocaleString() : "-"}</td>
                  <td className="py-2 pr-4">{c.name || c.id}</td>
                  <td className="py-2 pr-4">
                    {(c.base_pipeline_name ?? c.base_pipeline_id ?? "-")} → {(c.base_status_name ?? c.base_status_id ?? "-")}
                  </td>
                  <td className="py-2 pr-4">
                    {c.rules?.v1 ? `${c.rules.v1.op || "contains"} "${c.rules.v1.value || ""}"` : "-"}
                  </td>
                  <td className="py-2 pr-4">
                    {c.rules?.v2 ? `${c.rules.v2.op || "contains"} "${c.rules.v2.value || ""}"` : "-"}
                  </td>
                  <td className="py-2 pr-4">
                    {c.exp
                      ? `to ${c.exp.to_pipeline_name ?? c.exp.to_pipeline_id ?? "?"} → ${c.exp.to_status_name ?? c.exp.to_status_id ?? "?"}${
                          c.exp.trigger ? `, trigger: ${c.exp.trigger.op || "contains"} "${c.exp.trigger.value || ""}"` : ""
                        }`
                      : "-"}
                  </td>
                  <td className="py-2 pr-4">
                    v1: {c.v1_count ?? 0}, v2: {c.v2_count ?? 0}, exp: {c.exp_count ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
