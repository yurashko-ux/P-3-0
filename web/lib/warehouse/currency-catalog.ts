// Типовий довідник валют і країн. Це не мережа філій — лише підказка в UI.

export type CurrencyDirectoryRow = {
  code: string;
  title: string;
  countries: string[];
};

export const CURRENCY_DIRECTORY: CurrencyDirectoryRow[] = [
  { code: "UAH", title: "Українська гривня", countries: ["Україна"] },
  { code: "USD", title: "Долар США", countries: ["США", "Еквадор", "Сальвадор", "Панама", "Пуерто-Рико"] },
  {
    code: "EUR",
    title: "Євро",
    countries: [
      "Німеччина",
      "Франція",
      "Італія",
      "Іспанія",
      "Нідерланди",
      "Бельгія",
      "Австрія",
      "Португалія",
      "Ірландія",
      "Фінляндія",
      "Греція",
      "Словаччина",
      "Словенія",
      "Естонія",
      "Латвія",
      "Литва",
      "Люксембург",
      "Мальта",
      "Кіпр",
      "Хорватія",
    ],
  },
  { code: "PLN", title: "Польський злотий", countries: ["Польща"] },
  { code: "GBP", title: "Фунт стерлінгів", countries: ["Велика Британія"] },
  { code: "CHF", title: "Швейцарський франк", countries: ["Швейцарія", "Ліхтенштейн"] },
  { code: "CZK", title: "Чеська крона", countries: ["Чехія"] },
  { code: "HUF", title: "Угорський форинт", countries: ["Угорщина"] },
  { code: "RON", title: "Румунський лей", countries: ["Румунія"] },
  { code: "MDL", title: "Молдовський лей", countries: ["Молдова"] },
  { code: "TRY", title: "Турецька ліра", countries: ["Туреччина"] },
  { code: "GEL", title: "Грузинський ларі", countries: ["Грузія"] },
  { code: "AZN", title: "Азербайджанський манат", countries: ["Азербайджан"] },
  { code: "KZT", title: "Казахстанський тенге", countries: ["Казахстан"] },
  { code: "CNY", title: "Китайський юань", countries: ["Китай"] },
  { code: "JPY", title: "Японська єна", countries: ["Японія"] },
  { code: "CAD", title: "Канадський долар", countries: ["Канада"] },
  { code: "AUD", title: "Австралійський долар", countries: ["Австралія"] },
  { code: "SEK", title: "Шведська крона", countries: ["Швеція"] },
  { code: "NOK", title: "Норвезька крона", countries: ["Норвегія"] },
  { code: "DKK", title: "Данська крона", countries: ["Данія"] },
  { code: "ILS", title: "Ізраїльський шекель", countries: ["Ізраїль"] },
  { code: "AED", title: "Дирхам ОАЕ", countries: ["ОАЕ"] },
];

export function findCurrencyByCode(code: string): CurrencyDirectoryRow | null {
  const key = String(code || "").trim().toUpperCase();
  return CURRENCY_DIRECTORY.find((row) => row.code === key) || null;
}

export function findCurrenciesByCountry(country: string): CurrencyDirectoryRow[] {
  const q = String(country || "").trim().toLowerCase();
  if (!q) return [];
  return CURRENCY_DIRECTORY.filter((row) => row.countries.some((c) => c.toLowerCase().includes(q)));
}

export function allCountries(): string[] {
  const set = new Set<string>();
  for (const row of CURRENCY_DIRECTORY) {
    for (const c of row.countries) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "uk"));
}
