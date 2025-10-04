import test from 'node:test';
import assert from 'node:assert/strict';

const kvStore = new Map<string, any>();

async function installKvMock() {
  const kvModule = await import('@vercel/kv');
  kvModule.kv.get = async <T = unknown>(key: string): Promise<T | null> => {
    return (kvStore.has(key) ? kvStore.get(key) : null) as T | null;
  };
  kvModule.kv.set = async (key: string, value: unknown) => {
    kvStore.set(key, value);
    return 'OK';
  };
  kvModule.kv.lrange = async <T = unknown>(key: string, _start: number, _stop: number): Promise<T[]> => {
    const value = kvStore.get(key);
    return Array.isArray(value) ? [...value] : [];
  };
  kvModule.kv.mget = async <T = unknown>(...keys: string[]): Promise<Array<T | null>> => {
    return keys.map((key) => (kvStore.has(key) ? kvStore.get(key) : null)) as Array<T | null>;
  };
}

test('POST rejects duplicate variant values', async () => {
  await installKvMock();
  kvStore.clear();
  const existingId = '1000';
  kvStore.set('cmp:ids', [existingId]);
  kvStore.set(`cmp:item:${existingId}`, {
    id: existingId,
    v1: 'Alpha',
    v2: 'Beta',
    counters: { v1: 0, v2: 0, exp: 0 },
    createdAt: Date.now(),
  });

  const { POST } = await import('./route');

  const req = {
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ name: 'Duplicate', v1: ' alpha ', v2: 'Gamma' }),
  } as any;

  const res = await POST(req);
  assert.equal(res.status, 409);
  const payload = await res.json();
  assert.equal(payload.ok, false);
  assert.match(String(payload.error), /alpha/);
  assert.match(String(payload.error), /1000/);

  const storedItems = Array.from(kvStore.entries()).filter(([key]) => key.startsWith('cmp:item:'));
  assert.equal(storedItems.length, 1);
});
