import { beforeEach, describe, expect, it, vi } from "vitest";

type KvMock = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  lrange: ReturnType<typeof vi.fn>;
  mget: ReturnType<typeof vi.fn>;
};

const kvMock: KvMock = {
  get: vi.fn(),
  set: vi.fn(),
  lrange: vi.fn(),
  mget: vi.fn(),
};

vi.mock("@vercel/kv", () => ({
  kv: kvMock,
}));

vi.mock("@/lib/keycrm", () => ({
  getPipelineName: vi.fn(async () => ""),
  getStatusName: vi.fn(async () => ""),
}));

const { POST } = await import("./route");

function createJsonRequest(body: Record<string, unknown>) {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as any;
}

describe("POST /api/campaigns", () => {
  beforeEach(() => {
    kvMock.get.mockReset();
    kvMock.set.mockReset();
    kvMock.lrange.mockReset();
    kvMock.mget.mockReset();
  });

  it("returns 409 when v1/v2 duplicates existing campaigns", async () => {
    kvMock.get.mockResolvedValue(["1"]);
    kvMock.lrange.mockResolvedValue(["1"]);
    kvMock.mget.mockResolvedValue([{ id: "1", v1: " Alpha ", v2: "beta" }]);

    const req = createJsonRequest({ name: "Test", v1: " alpha" });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const payload = await res.json();
    expect(payload).toMatchObject({ ok: false });
    expect(String(payload.error || "").toLowerCase()).toContain("alpha");
    expect(kvMock.set).not.toHaveBeenCalled();
  });

  it("creates campaign when values are unique", async () => {
    kvMock.get.mockResolvedValue([]);
    kvMock.lrange.mockResolvedValue([]);
    kvMock.mget.mockResolvedValue([]);

    const req = createJsonRequest({ name: "Test", v1: "gamma" });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload).toMatchObject({ ok: true, id: expect.any(String) });
    expect(kvMock.set).toHaveBeenCalled();
  });
});
