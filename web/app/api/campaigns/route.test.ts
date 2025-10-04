import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "./route.ts";
import { __resetKvMock, __setKvMock, __getKvCalls } from "@vercel/kv";

const duplicateCampaign = {
  id: "existing",
  name: "Existing",
  v1: "Duplicate",
  counters: { v1: 0, v2: 0, exp: 0 },
  createdAt: Date.now() - 1000,
};

test("POST /api/campaigns rejects duplicate V1", async () => {
  __resetKvMock();
  __setKvMock({
    get: async () => ["existing"],
    lrange: async () => [],
    mget: async () => [duplicateCampaign],
  });

  const headers = new Headers({ "content-type": "application/json" });
  const req = {
    headers,
    json: async () => ({
      name: "New campaign",
      v1: " duplicate  ",
    }),
    formData: async () => null,
  } as any;

  const res = await POST(req);
  assert.equal(res.status, 409);
  const payload = await res.json();
  assert.deepEqual(payload.ok, false);
  assert.match(String(payload.error ?? ""), /V1/);
  assert.match(String(payload.error ?? ""), /existing/);

  const setCalls = __getKvCalls().filter((c) => c.method === "set");
  assert.equal(setCalls.length, 0);
});
