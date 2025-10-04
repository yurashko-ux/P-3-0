import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@vercel/kv", () => {
  const get = vi.fn();
  const set = vi.fn();
  const lrange = vi.fn();
  const mget = vi.fn();
  return {
    kv: { get, set, lrange, mget },
  };
});

const { POST } = await import("./route");
const { kv } = await import("@vercel/kv");

const kvMock = kv as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  lrange: ReturnType<typeof vi.fn>;
  mget: ReturnType<typeof vi.fn>;
};

describe("POST /api/campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects duplicate variant values", async () => {
    kvMock.get.mockImplementation(async () => ["existing"]);
    kvMock.lrange.mockResolvedValue([]);
    kvMock.mget.mockResolvedValue([
      {
        id: "existing",
        name: "Existing campaign",
        counters: { v1: 0, v2: 0, exp: 0 },
        createdAt: 1,
        v1: "Alpha",
      },
    ]);
    kvMock.set.mockResolvedValue(undefined);

    const request = new NextRequest("http://test.local/api/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "New", v1: " alpha " }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload).toMatchObject({ ok: false });
    expect(String(payload.error)).toContain("v1");
    expect(String(payload.error)).toContain("existing");
    expect(kvMock.set).not.toHaveBeenCalled();
  });

  it("allows unique variant values", async () => {
    kvMock.get.mockImplementation(async () => []);
    kvMock.lrange.mockResolvedValue([]);
    kvMock.mget.mockResolvedValue([]);
    kvMock.set.mockResolvedValue(undefined);

    const request = new NextRequest("http://test.local/api/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "Unique", v1: "alpha", v2: "beta" }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toMatchObject({ ok: true, id: expect.any(String) });
    expect(kvMock.set).toHaveBeenCalledTimes(2);
    const [firstKey, firstValue] = kvMock.set.mock.calls[0];
    expect(firstKey).toMatch(/^cmp:item:/);
    expect(firstValue).toMatchObject({ v1: "alpha", v2: "beta" });
  });
});
