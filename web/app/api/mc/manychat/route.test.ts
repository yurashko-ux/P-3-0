import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

import { POST } from './route.ts';
import { kvRead, kvWrite } from '../../../../lib/kv';

type RequestInitOptions = {
  headers?: Record<string, string>;
  queryToken?: string | null;
  body?: any;
};

function makeRequest(opts: RequestInitOptions = {}) {
  const url = new URL('https://example.com/api/mc/manychat');
  if (opts.queryToken !== undefined) {
    if (opts.queryToken !== null) {
      url.searchParams.set('token', opts.queryToken);
    }
  }

  const headers = new Headers(opts.headers);
  const body = opts.body ?? {};

  return {
    headers,
    nextUrl: url,
    url: url.toString(),
    async json() {
      return body;
    },
  } as any;
}

function stubKv() {
  const listStub = mock.method(kvRead, 'listCampaigns', async () => []);
  const logStub = mock.method(kvWrite, 'lpush', async () => {});
  return () => {
    listStub.mock.restore();
    logStub.mock.restore();
  };
}

test('accepts request when MC_TOKEN matches Authorization header', async () => {
  process.env.MC_TOKEN = 'secret';
  const restore = stubKv();
  try {
    const req = makeRequest({
      headers: { Authorization: 'Bearer secret' },
      body: { any: 'payload' },
    });
    const res = await POST(req);
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.ok, true);
  } finally {
    restore();
    delete process.env.MC_TOKEN;
  }
});

test('accepts request when MC_TOKEN matches query parameter', async () => {
  process.env.MC_TOKEN = 'secret';
  const restore = stubKv();
  try {
    const req = makeRequest({ queryToken: 'secret', body: { ok: true } });
    const res = await POST(req);
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.ok, true);
  } finally {
    restore();
    delete process.env.MC_TOKEN;
  }
});

test('rejects request when MC_TOKEN is set but token is missing', async () => {
  process.env.MC_TOKEN = 'secret';
  const restore = stubKv();
  try {
    const req = makeRequest({ body: { missing: true } });
    const res = await POST(req);
    assert.equal(res.status, 401);
    const payload = await res.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error, 'invalid token');
  } finally {
    restore();
    delete process.env.MC_TOKEN;
  }
});

test('rejects request when MC_TOKEN is set but token is incorrect', async () => {
  process.env.MC_TOKEN = 'secret';
  const restore = stubKv();
  try {
    const req = makeRequest({
      headers: { 'x-mc-token': 'wrong' },
      body: { invalid: true },
    });
    const res = await POST(req);
    assert.equal(res.status, 401);
    const payload = await res.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error, 'invalid token');
  } finally {
    restore();
    delete process.env.MC_TOKEN;
  }
});
