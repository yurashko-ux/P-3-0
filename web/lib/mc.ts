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
    const rawText = await req.text();
    const trimmed = rawText.trim();
    if (!trimmed) return {};

    try {
      return JSON.parse(trimmed);
    } catch {
      // ignore JSON parse error and attempt to treat the payload as form data below
    }

    try {
      if (!trimmed.includes('=')) {
        return {};
      }

      const params = new URLSearchParams(trimmed);
      const obj: Record<string, unknown> = {};

      // URLSearchParams will happily accept arbitrary strings, so guard against
      // cases where `trimmed` wasn't actually form-encoded. We require at least
      // one key/value pair to treat the payload as a map.
      let hasEntries = false;
      for (const [key, value] of params.entries()) {
        hasEntries = true;
        let parsed: unknown = value;
        const vTrim = value.trim();
        if ((vTrim.startsWith('{') && vTrim.endsWith('}')) || (vTrim.startsWith('[') && vTrim.endsWith(']'))) {
          try {
            parsed = JSON.parse(vTrim);
          } catch {
            parsed = vTrim;
          }
        }

        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const existing = obj[key];
          if (Array.isArray(existing)) {
            existing.push(parsed);
          } else {
            obj[key] = [existing, parsed];
          }
        } else {
          obj[key] = parsed;
        }
      }

      if (hasEntries) {
        return obj;
      }
    } catch {
      // ignore form parsing errors and fall back to returning an empty object
    }

    return {};
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
