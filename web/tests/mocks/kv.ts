type KvMethod = keyof KvImpl;
export type KvCall = { method: KvMethod; args: any[] };

type KvImpl = {
  get: (...args: any[]) => Promise<any>;
  lrange: (...args: any[]) => Promise<any>;
  mget: (...args: any[]) => Promise<any>;
  set: (...args: any[]) => Promise<any>;
};

const defaultImpl: KvImpl = {
  get: async () => undefined,
  lrange: async () => [],
  mget: async () => [],
  set: async () => undefined,
};

const impl: KvImpl = { ...defaultImpl };
const calls: KvCall[] = [];

function record<T extends KvMethod>(method: T, args: any[]): Promise<any> {
  calls.push({ method, args });
  return impl[method](...args);
}

export const kv = {
  get: async (...args: any[]) => record("get", args),
  lrange: async (...args: any[]) => record("lrange", args),
  mget: async (...args: any[]) => record("mget", args),
  set: async (...args: any[]) => record("set", args),
};

export function __resetKvMock() {
  Object.assign(impl, defaultImpl);
  calls.length = 0;
}

export function __setKvMock(overrides: Partial<KvImpl>) {
  Object.assign(impl, overrides);
}

export function __getKvCalls(): KvCall[] {
  return [...calls];
}
