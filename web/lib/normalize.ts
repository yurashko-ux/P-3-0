// Корисні допоміжні утиліти для «дивних» значень, що інколи приходять з KV.

export function unwrapDeep<T = unknown>(v: any): T {
  // Розпаковує вкладені об'єкти виду { value: ... } доки можливо
  let x = v;
  let guard = 0;
  while (x && typeof x === 'object' && 'value' in x && guard < 20) {
    x = (x as any).value;
    guard++;
  }
  return x as T;
}

export function normalizeId(x: any): string {
  const v = unwrapDeep<any>(x);
  if (v == null) return '';
  return String(v);
}

export function uniqIds(arr: any[]): string[] {
  const set = new Set<string>();
  for (const v of arr || []) set.add(normalizeId(v));
  return Array.from(set).filter(Boolean);
}
