// web/lib/redis.ts
// Підключення до Upstash KV з ПРАВАМИ НА ЗАПИС
import { Redis } from '@upstash/redis';

const url =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL;

const token =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  throw new Error(
    'KV is not configured: missing KV_REST_API_URL and/or KV_REST_API_TOKEN (write token).'
  );
}

export const redis = new Redis({ url, token });

// Невеликий self-check у дев/прев’ю
if (process.env.NODE_ENV !== 'production') {
  (async () => {
    try {
      const probe = `campaigns:__probe__:${Date.now()}`;
      await redis.set(probe, JSON.stringify({ t: Date.now() }));
      await redis.del(probe);
    } catch (e) {
      console.error('KV write self-check failed:', e);
    }
  })();
}
