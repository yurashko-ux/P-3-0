// lib/kvStore.ts
import { kv as vercelKV } from "@vercel/kv";

const hasVercelKV =
  !!process.env.KV_REST_API_URL ||
  !!process.env.UPSTASH_REDIS_REST_URL ||
  !!process.env.KV_URL;

type Store = {
  get<T = any>(key: string): Promise<T | null>;
  set<T = any>(key: string, value: T): Promise<void>;
};

class MemoryStore implements Store {
  private map = (globalThis as any).__MEMKV__ ?? new Map<string, any>();
  constructor() { (globalThis as any).__MEMKV__ = this.map; }
  async get<T>(k: string) { return this.map.has(k) ? (this.map.get(k) as T) : null; }
  async set<T>(k: string, v: T) { this.map.set(k, v); }
}

export const store: Store = hasVercelKV
  ? {
      async get<T>(key) { return (await vercelKV.get<T>(key)) ?? null; },
      async set<T>(key, value) { await vercelKV.set(key, value); },
    }
  : new MemoryStore();
