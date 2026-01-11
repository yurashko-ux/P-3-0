// web/lib/name-normalize.ts
// Нормалізація імен для порівняння (українська ↔ англійська)

/**
 * Транслітерація українських букв в англійські еквіваленти
 */
const UKRAINIAN_TO_ENGLISH: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g',
  'д': 'd', 'е': 'e', 'є': 'ie', 'ж': 'zh', 'з': 'z',
  'и': 'y', 'і': 'i', 'ї': 'i', 'й': 'i', 'к': 'k',
  'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p',
  'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f',
  'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
  'ь': '', 'ю': 'iu', 'я': 'ia',
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'H', 'Ґ': 'G',
  'Д': 'D', 'Е': 'E', 'Є': 'Ie', 'Ж': 'Zh', 'З': 'Z',
  'И': 'Y', 'І': 'I', 'Ї': 'I', 'Й': 'I', 'К': 'K',
  'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P',
  'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F',
  'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
  'Ь': '', 'Ю': 'Iu', 'Я': 'Ia',
};

/**
 * Спеціальні випадки транслітерації (поширені імена)
 */
const SPECIAL_CASES: Record<string, string> = {
  // Українські → Англійські
  'Тетяна': 'Tetiana',
  'Тетьяна': 'Tetiana',
  'Овчаренко': 'Ovcharenko',
  // Можна додати інші поширені варіанти
};

/**
 * Нормалізує ім'я для порівняння (транслітерує українські букви в англійські)
 */
export function normalizeNameForComparison(name: string): string {
  if (!name) return '';
  
  // Перевіряємо спеціальні випадки
  const normalized = name.trim();
  if (SPECIAL_CASES[normalized]) {
    return SPECIAL_CASES[normalized].toLowerCase();
  }
  
  // Транслітеруємо посимвольно
  let result = '';
  for (const char of normalized) {
    if (UKRAINIAN_TO_ENGLISH[char]) {
      result += UKRAINIAN_TO_ENGLISH[char];
    } else if (/[a-zA-Z0-9]/.test(char)) {
      result += char;
    }
  }
  
  return result.toLowerCase();
}

/**
 * Створює ключ для порівняння імен (firstName + lastName)
 * Повертає обидва варіанти: оригінальний (lowercase) та нормалізований (транслітерований)
 */
export function createNameComparisonKey(firstName: string | null | undefined, lastName: string | null | undefined): {
  original: string;
  normalized: string;
} {
  const first = (firstName || '').trim().toLowerCase();
  const last = (lastName || '').trim().toLowerCase();
  const original = `${first} ${last}`.trim();
  const normalized = `${normalizeNameForComparison(firstName || '')} ${normalizeNameForComparison(lastName || '')}`.trim();
  
  return { original, normalized };
}

/**
 * Перевіряє, чи збігаються два імені (з урахуванням нормалізації)
 */
export function namesMatch(
  firstName1: string | null | undefined,
  lastName1: string | null | undefined,
  firstName2: string | null | undefined,
  lastName2: string | null | undefined
): boolean {
  const key1 = createNameComparisonKey(firstName1, lastName1);
  const key2 = createNameComparisonKey(firstName2, lastName2);
  
  // Порівнюємо оригінальні (якщо однакові)
  if (key1.original === key2.original && key1.original) {
    return true;
  }
  
  // Порівнюємо нормалізовані (транслітеровані)
  if (key1.normalized === key2.normalized && key1.normalized) {
    return true;
  }
  
  return false;
}