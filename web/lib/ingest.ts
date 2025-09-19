// web/lib/ingest.ts
// Нормалізація вхідних полів ManyChat + прості утиліти пошуку в локальному KV

export type ManyChatIn = {
  username?: string | null;  // IG handle (може бути з @)
  text?: string | null;
  full_name?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

export type NormalizedMC = {
  handle: string | null;     // "someuser" (без "@")
  handleRaw: string | null;  // як прийшло
  text: string;
  fullName: string;          // об'єднане ім'я
};

export function normalizeManyChat(input: ManyChatIn | any): NormalizedMC {
  const handleRaw = String(input?.username ?? '').trim() || null;
  const handle = handleRaw ? handleRaw.replace(/^@+/, '').toLowerCase() : null;

  const first = String(input?.first_name ?? '').trim();
  const last = String(input?.last_name ?? '').trim();
  const fnCandidates = [
    String(input?.name ?? '').trim(),
    String(input?.full_name ?? '').trim(),
    [first, last].filter(Boolean).join(' ').trim(),
  ].filter(Boolean);

  const fullName = (fnCandidates[0] ?? '').trim();
  const text = String(input?.text ?? '').trim();

  return { handle, handleRaw, text, fullName };
}

// ---- простий скорер імені (токени/substring) ----
export function scoreByName(query: string, target: string): number {
  const q = query.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  if (!q || !t) return 0;
  if (q === t) return 100;
  if (t.includes(q)) return 80;

  const qt = q.split(/\s+/).filter(Boolean);
  const tt = new Set(t.split(/\s+/).filter(Boolean));
  if (!qt.length || !tt.size) return 0;

  const overlap = qt.filter((x) => tt.has(x)).length / qt.length;
  if (overlap >= 0.6) return 70;
  if (overlap >= 0.4) return 60;
  return 0;
}
