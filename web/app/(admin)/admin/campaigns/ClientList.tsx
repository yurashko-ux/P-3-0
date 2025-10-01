/* ==== утиліти ============================================ */
function looksLikeJson(s: string) {
  const t = s.trim();
  return (
    (t.startsWith('{') && t.endsWith('}')) ||
    (t.startsWith('[') && t.endsWith(']'))
  );
}

function tryJsonParse(s: string): any {
  // інколи приходить з подвійною екрануванням \" - це валідний JSON, просто глибоко
  try {
    return JSON.parse(s);
  } catch {
    // спроба «розекранувати» один рівень, якщо це явно \"…\"
    try {
      const unescaped = s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      return JSON.parse(unescaped);
    } catch {
      return s;
    }
  }
}

/** Дуже терплячий розпакувальник «цибулі» { value: ... } + JSON-рядків */
function unwrapDeep(input: any): any {
  let cur: any = input;
  let guard = 0;

  while (guard++ < 50) {
    // 1) якщо рядок схожий на JSON – парсимо
    if (typeof cur === 'string' && looksLikeJson(cur)) {
      const parsed = tryJsonParse(cur);
      if (parsed !== cur) {
        cur = parsed;
        continue;
      }
    }

    // 2) якщо об’єкт з одним полем value – беремо його
    if (cur && typeof cur === 'object' && 'value' in cur) {
      cur = (cur as any).value;
      continue;
    }

    // 3) якщо ще рядок і виглядає як вкладений JSON у лапках – ще раз
    if (typeof cur === 'string') {
      // буває '{"value":"123"}' у рядку
      try {
        const maybe = JSON.parse(cur);
        if (maybe && typeof maybe === 'object') {
          cur = maybe;
          continue;
        }
      } catch {
        // не парситься – значить це кінцеве значення
      }
    }

    break; // більше нічого розкручувати
  }

  return cur;
}

/** Нормалізує одну кампанію: id/v1/v2/base -> чисті значення */
function normalizeItem(raw: any): Campaign {
  // id може бути будь-чим: number | string | {value: ...} | JSON-рядок
  let id = unwrapDeep(raw?.id ?? raw?._id ?? '');
  if (id && typeof id === 'object' && 'value' in id) id = unwrapDeep(id.value);
  id = id != null ? String(id) : '';

  const v1 = unwrapDeep(raw?.v1?.value ?? raw?.v1) ?? undefined;
  const v2 = unwrapDeep(raw?.v2?.value ?? raw?.v2) ?? undefined;

  const base = raw?.base ?? {};
  const pipeline =
    unwrapDeep(base?.pipelineName ?? base?.pipeline?.name ?? base?.pipeline) ?? undefined;
  const status =
    unwrapDeep(base?.statusName ?? base?.status?.name ?? base?.status) ?? undefined;

  return {
    id,
    name: unwrapDeep(raw?.name) ?? undefined,
    v1: { value: typeof v1 === 'string' ? v1 : String(v1 ?? '') || undefined },
    v2: { value: typeof v2 === 'string' ? v2 : String(v2 ?? '') || undefined },
    base: {
      pipeline,
      status,
      pipelineName: pipeline,
      statusName: status,
    },
    counters: {
      v1: Number(unwrapDeep(raw?.counters?.v1 ?? 0)) || 0,
      v2: Number(unwrapDeep(raw?.counters?.v2 ?? 0)) || 0,
      exp: Number(unwrapDeep(raw?.counters?.exp ?? 0)) || 0,
    },
    createdAt: unwrapDeep(raw?.createdAt) ?? undefined,
    deleted: Boolean(raw?.deleted),
  };
}
