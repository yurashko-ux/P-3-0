// web/lib/auth.ts
// Проста адмін-автентифікація для роутів адмінки/API.
// Джерела пароля: Authorization: Bearer <ADMIN_PASS>, X-Admin-Pass, cookie "admin_pass", або ?admin=<...>

function readCookie(name: string, cookieHeader?: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(/;\s*/);
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function readAdminPassFromReq(req: Request): string | undefined {
  const h = req.headers;
  // 1) Authorization: Bearer <token>
  const auth = h.get("authorization") || h.get("Authorization");
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  // 2) X-Admin-Pass
  const x = h.get("x-admin-pass") || h.get("X-Admin-Pass");
  if (x && x.trim()) return x.trim();

  // 3) cookie admin_pass
  const cookie = h.get("cookie");
  const c = readCookie("admin_pass", cookie);
  if (c && c.trim()) return c.trim();

  // 4) ?admin=
  try {
    const u = new URL(req.url);
    const q = u.searchParams.get("admin");
    if (q && q.trim()) return q.trim();
  } catch {
    /* ignore bad URL */
  }

  return undefined;
}

/**
 * Перевірка, чи запит автентифікований як адмін.
 * Якщо ADMIN_PASS не заданий в env — доступ дозволено (dev/preview режим).
 */
export async function isAdmin(req: Request): Promise<boolean> {
  const required = process.env.ADMIN_PASS;
  if (!required || !required.trim()) {
    // немає встановленого пароля → не блокуємо (зручно для прев’ю/локально)
    return true;
  }
  const got = readAdminPassFromReq(req);
  return got === required;
}

/**
 * Використовується в роут-хендлерах: await assertAdmin(req)
 * Кидає помилку при неуспішній перевірці (Next поверне 500, але ми зупинимо виконання).
 * Якщо хочете явно 401 — обгорніть виклик у try/catch у роуті та поверніть Response з 401.
 */
export async function assertAdmin(req: Request): Promise<void> {
  const ok = await isAdmin(req);
  if (!ok) {
    throw new Error("Unauthorized (admin)");
  }
}
