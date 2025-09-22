"use client";

import { useEffect, useMemo, useState } from "react";

type Rule = { op?: "contains" | "equals"; value?: string };

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(
    new RegExp("(?:^|;\\s*)" + name.replace(/[-.[\\]{}()*+?^$|\\\\]/g, "\\$&") + "=([^;]*)")
  );
  return m ? decodeURIComponent(m[1]) : null;
}

export default function AdminCampaignNewPage() {
  // --- admin token handling ---
  const [token, setToken] = useState<string>("");
  useEffect(() => {
    const fromCookie = readCookie("admin_token");
    const fromLS = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
    const t = (fromCookie || fromLS || "").trim();
    if (t) setToken(t);
  }, []);
  useEffect(() => {
    if (token && typeof window !== "undefined") {
      localStorage.setItem("admin_token", token);
      document.cookie = `admin_token=${encodeURIComponent(token)}; Max-Age=${60 * 60 * 24 * 30}; Path=/; SameSite=Lax`;
    }
  }, [token]);
  const validToken = useMemo(() => (token || "").trim(), [token]);

  // --- form state ---
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

  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);

    if (!validToken) {
      setError("Введи ADMIN_TOKEN (поле вгорі праворуч) і спробуй ще раз.");
      return;
    }

    const body = {
      name: name || "",
      base_pipeline_id: basePipelineId ? Number(basePipelineId) : undefined,
      base_status_id: baseStatusId ? Number(baseStatusId) : undefined,
      rules: {
        v1: { op: v1Op, value: v1Value || "" } as Rule,
        v2: v2Value ? ({ op: v2Op, value: v2Value } as Rule) : undefined,
      },
      exp:
        expPipelineId || expStatusId || expValue
          ? {
              to_pipeline_id: expPipelineId ? Number(expPipelineId) : undefined,
              to_status_id: expStatusId ? Number(expStatusId) : undefined,
              trigger: expValue ? ({ op: expOp, value: expValue } as Rule) : undefined,
            }
          : undefined,
      active: true,
    };

    const url = `/api/campaigns?token=${encodeURIComponent(validToken)}`;

    setSubmitting(true);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j?.error || r.statusText || "Create failed");

      setOkMsg(`Створено: ${j.id || "ok"}`);
      // опційно — редірект у список
      // location.href = "/admin/campaigns?created=1";
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Create Campaign</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="border rounded px-2 py-1 text-sm w-[280px]"
            placeholder="ADMIN_TOKEN"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <span className={`text-xs px-2 py-1 rounded ${validToken ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {validToken ? "token ✓" : "нема токена"}
          </span>
        </div>
      </div>

      <form onSubmit={onCreate} className="border rounded-lg p-4 space-y-4">
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

        <div className="flex gap-2 items-center">
          <button
            type="submit"
            disabled={submitting}
            className="bg-black text-white px-4 py-2 rounded hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create"}
          </button>
          <a className="text-sm underline" href="/admin/campaigns">
            ← Back to list
          </a>
        </div>

        {error && <div className="text-red-600 text-sm mt-2">Error: {error}</div>}
        {okMsg && <div className="text-green-700 text-sm mt-2">{okMsg}</div>}
      </form>
    </div>
  );
}
