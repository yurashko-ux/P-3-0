// Пошук DirectClient за ПІБ з Telegram (латиниця ↔ кирилиця).

const FIRST_NAME_VARIANTS: Record<string, string[]> = {
  mykolay: ['mykolay', 'микола', 'mykola', 'nikolay'],
  микола: ['mykolay', 'микола', 'mykola'],
  mykola: ['mykolay', 'микола', 'mykola'],
};

const LAST_NAME_VARIANTS: Record<string, string[]> = {
  yurashko: ['yurashko', 'юрашко', 'iurashko'],
  юрашко: ['yurashko', 'юрашко'],
};

function tokenVariants(token: string, map: Record<string, string[]>): string[] {
  const t = token.trim().toLowerCase();
  if (!t) return [];
  const set = new Set<string>([t]);
  for (const [key, list] of Object.entries(map)) {
    if (t.includes(key) || key.includes(t)) {
      for (const v of list) set.add(v);
    }
  }
  return [...set];
}

/** Усі варіанти пар імʼя+прізвище для пошуку в Direct. */
export function buildNameSearchPairs(first: string, last: string): Array<[string, string]> {
  const fnVars = tokenVariants(first, FIRST_NAME_VARIANTS);
  const lnVars = tokenVariants(last, LAST_NAME_VARIANTS);
  const pairs: Array<[string, string]> = [];
  for (const f of fnVars) {
    for (const l of lnVars) {
      pairs.push([f, l]);
      pairs.push([l, f]);
    }
  }
  return pairs;
}
