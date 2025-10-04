import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { POST } from './route';

const ORIGINAL_MC_TOKEN = process.env.MC_TOKEN;

function createRequest(options: {
  headerToken?: string;
  queryToken?: string;
  body?: any;
} = {}) {
  const { headerToken, queryToken, body } = options;
  const url = new URL('https://example.com/api/mc/manychat');
  if (queryToken !== undefined) {
    url.searchParams.set('token', queryToken);
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (headerToken) headers['x-mc-token'] = headerToken;
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      body ?? {
        message: { text: 'hello world' },
      }
    ),
  });
}

async function readJson(res: Response) {
  return res.json() as Promise<any>;
}

test('accepts valid token provided in x-mc-token header', async (t) => {
  process.env.MC_TOKEN = 'secret';
  t.after(() => {
    process.env.MC_TOKEN = ORIGINAL_MC_TOKEN;
  });

  const res = await POST(createRequest({ headerToken: 'secret' }));
  assert.equal(res.status, 200);
  const body = await readJson(res);
  assert.equal(body.ok, true);
});

test('accepts valid token provided as query parameter', async (t) => {
  process.env.MC_TOKEN = 'secret';
  t.after(() => {
    process.env.MC_TOKEN = ORIGINAL_MC_TOKEN;
  });

  const res = await POST(createRequest({ queryToken: 'secret' }));
  assert.equal(res.status, 200);
  const body = await readJson(res);
  assert.equal(body.ok, true);
});

test('rejects request when no token is provided', async (t) => {
  process.env.MC_TOKEN = 'secret';
  t.after(() => {
    process.env.MC_TOKEN = ORIGINAL_MC_TOKEN;
  });

  const res = await POST(createRequest());
  assert.equal(res.status, 401);
  const body = await readJson(res);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'invalid token');
});

test('rejects request when token is incorrect', async (t) => {
  process.env.MC_TOKEN = 'secret';
  t.after(() => {
    process.env.MC_TOKEN = ORIGINAL_MC_TOKEN;
  });

  const res = await POST(createRequest({ headerToken: 'nope' }));
  assert.equal(res.status, 401);
  const body = await readJson(res);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'invalid token');
});

