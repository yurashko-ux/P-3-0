import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';

const listCampaignsMock = vi.fn(async () => []);
const lpushMock = vi.fn(async () => undefined);
const lrangeMock = vi.fn(async () => []);

vi.mock('@/lib/kv', () => ({
  kvRead: {
    listCampaigns: listCampaignsMock,
    lrange: lrangeMock,
  },
  kvWrite: {
    lpush: lpushMock,
  },
  campaignKeys: {
    INDEX_KEY: 'campaign:index',
  },
}));

type RequestOptions = {
  headerToken?: string;
  bearerToken?: string;
  queryToken?: string;
  body?: unknown;
};

function buildRequest({ headerToken, bearerToken, queryToken, body = {} }: RequestOptions) {
  const headers = new Headers();
  if (headerToken !== undefined) {
    headers.set('x-mc-token', headerToken);
  }
  if (bearerToken !== undefined) {
    headers.set('authorization', `Bearer ${bearerToken}`);
  }

  const searchParams = new URLSearchParams();
  if (queryToken !== undefined) {
    searchParams.set('token', queryToken);
  }

  const jsonMock = vi.fn(async () => body);

  const req = {
    headers,
    nextUrl: { searchParams },
    json: jsonMock,
  } as unknown as NextRequest;

  return { req, jsonMock };
}

beforeEach(() => {
  listCampaignsMock.mockClear();
  lpushMock.mockClear();
  lrangeMock.mockClear();
});

afterEach(() => {
  delete process.env.MC_TOKEN;
});

describe('POST /api/mc/manychat', () => {
  it('accepts requests with a valid header token', async () => {
    process.env.MC_TOKEN = 'secret';
    const { req } = buildRequest({ headerToken: 'secret' });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(listCampaignsMock).toHaveBeenCalled();
  });

  it('accepts requests with a valid query token', async () => {
    process.env.MC_TOKEN = 'secret';
    const { req } = buildRequest({ queryToken: 'secret' });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(listCampaignsMock).toHaveBeenCalled();
  });

  it('rejects requests without a token when verification is enabled', async () => {
    process.env.MC_TOKEN = 'secret';
    const { req, jsonMock } = buildRequest({});

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data).toEqual({ ok: false, error: 'invalid token' });
    expect(jsonMock).not.toHaveBeenCalled();
    expect(listCampaignsMock).not.toHaveBeenCalled();
  });

  it('rejects requests with an incorrect token', async () => {
    process.env.MC_TOKEN = 'secret';
    const { req, jsonMock } = buildRequest({ headerToken: 'wrong' });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data).toEqual({ ok: false, error: 'invalid token' });
    expect(jsonMock).not.toHaveBeenCalled();
    expect(listCampaignsMock).not.toHaveBeenCalled();
  });
});
