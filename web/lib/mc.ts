// web/lib/mc.ts
export type ManychatRaw = {
  username?: string;
  user_name?: string;
  instagram_username?: string;
  text?: string;
  message?: string;
  last_input_text?: string;
  input?: string;

  // можливі варіанти ПІБ
  full_name?: string;
  fullname?: string;
  name?: string;
  fullName?: string;

  contact?: {
    name?: string;
    full_name?: string;
    username?: string;
  };
};

function pickFirstString(...vals: Array<unknown>): string {
  for (const v of vals) {
    if (typeof v === "string") {
      const s = v.trim();
      if (s) return s;
    }
  }
  return "";
}

/** Безпечно читаємо JSON (працює навіть якщо ManyChat шле text/plain) */
export async function readJsonSafe(req: Request): Promise<any> {
  try {
    return await req.clone().json();
  } catch {
    const t = await req.text();
    try {
      return JSON.parse(t);
    } catch {
      return {};
    }
  }
}

/** Нормалізація ManyChat → { username, text, fullName } */
export function normalizeManychatPayload(raw: any) {
  const b = (raw || {}) as ManychatRaw;

  const username = pickFirstString(
    b.username,
    b.user_name,
    b.instagram_username,
    b.contact?.username
  );

  const text = pickFirstString(b.text, b.message, b.last_input_text, b.input);

  const fullName = pickFirstString(
    b.full_name,
    b.fullname,
    b.name,
    b.fullName,
    b.contact?.full_name,
    b.contact?.name
  );

  return { username, text, fullName };
}
