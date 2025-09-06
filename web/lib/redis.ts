// web/lib/redis.ts
// ЄДИНЕ місце підключення до Upstash KV з ПРАВАМИ НА ЗАПИС
import { Redis } from '@upstash/redis';

// Використовуємо тільки ПИСЬМОВИЙ токен.
// Не підставляємо READ_ONLY, інакше set/zadd "успішно" нічого не зроблять.
const url =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL; // запасний варіант імені змінної

const token =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN; // запасний варіант імені змінної

if (!url || !token) {
  // Явна помилка на сервері, щоб не було "тихого" ок без запису
  throw new Error(
    'KV is not configured: missing KV_REST_API_URL and/or KV_REST_API_TOKEN (write token).'
  );
}

export const redis = new Redis({ url, token });

// Невеликий самотест у дев/прев’ю, щоби одразу бачити проблему з правами
// (на проді не викликається)
if (process.env.NODE_ENV !== 'production') {
  (async () => {
    try {
      const probeKey = `campaigns:__probe__:${Date.now()}`;
      await redis.set(probeKey, JSON.stringify({ t: Date.now() }));
      await redis.del(probeKey);
    } catch (e) {
      console.error('KV write self-check failed:', e);
    }
  })();
}
