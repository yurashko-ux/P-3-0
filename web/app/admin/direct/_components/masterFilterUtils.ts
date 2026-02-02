// web/app/admin/direct/_components/masterFilterUtils.ts
// Утиліти для фільтрів майстрів: лише імена з DirectMaster, об'єднання "Ім'я" та "Ім'я Прізвище"

/**
 * Повертає перший токен (ім'я) з рядка, без прізвища.
 */
export function firstToken(name: string | null | undefined): string {
  if (name == null) return '';
  const t = (name || '').toString().trim();
  const part = t.split(/\s+/)[0] || '';
  return part.trim();
}

/**
 * Множина дозволених імен (перших токенів) з списку відповідальних (DirectMaster).
 * У фільтрі показуємо лише майстрів/адміністраторів, які є в системі.
 */
export function getAllowedFirstNames(masters: { id: string; name: string }[]): Set<string> {
  const set = new Set<string>();
  for (const m of masters) {
    const first = firstToken(m.name);
    if (first) set.add(first);
  }
  return set;
}

/**
 * Групує рядки імен по firstToken і рахує суму; залишає лише ті імена, що в allowedFirstNames.
 * Повертає масив { name: ім'я, count: сума } відсортований по name.
 */
export function groupByFirstTokenAndFilter(
  rawNames: (string | null | undefined)[],
  allowedFirstNames: Set<string>
): Array<{ name: string; count: number }> {
  const map = new Map<string, number>();
  for (const raw of rawNames) {
    const n = (raw || '').toString().trim();
    if (!n) continue;
    const first = firstToken(n);
    if (!first || !allowedFirstNames.has(first)) continue;
    map.set(first, (map.get(first) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
