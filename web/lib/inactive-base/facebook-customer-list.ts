// Файл клієнтської аудиторії для кабінету Facebook (Ads Manager).
// Без хешування: кабінет хешує сам під час завантаження. Попередній SHA-256 зіпсував би збіги.
// Колонки лише з офіційних заголовків Meta: phone, fn, ln, zip, st, country, value.
// zip і st — локація салону: індекс 79000 і регіон lviv.
// st лише латиницею: Facebook не зіставляє «Львів» з регіоном у профілі.

export type FacebookCustomerSource = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  spent: number | null;
};

export type FacebookCustomerListResult = {
  csv: string;
  rows: number;
  ua: number;
  skipped: number;
  merged: number;
};

type PhoneHit = { phone: string; country: string };

/** Індекс Львова і регіон для кожної строки файлу. */
const LVIV_ZIP = "79000";
const LVIV_REGION = "lviv";

type CsvRow = { phone: string; fn: string; ln: string; country: string; value: number };

/** Код країни → ISO. Довший префікс перевіряється першим. min/max — довжина всього номера. */
const CALLING_CODES: Array<{ code: string; country: string; min: number; max: number }> = [
  { code: "380", country: "UA", min: 12, max: 12 },
  { code: "375", country: "BY", min: 12, max: 12 },
  { code: "373", country: "MD", min: 11, max: 12 },
  { code: "374", country: "AM", min: 11, max: 12 },
  { code: "995", country: "GE", min: 12, max: 12 },
  { code: "994", country: "AZ", min: 12, max: 12 },
  { code: "998", country: "UZ", min: 12, max: 12 },
  { code: "972", country: "IL", min: 11, max: 12 },
  { code: "971", country: "AE", min: 11, max: 12 },
  { code: "420", country: "CZ", min: 12, max: 12 },
  { code: "421", country: "SK", min: 12, max: 12 },
  { code: "370", country: "LT", min: 11, max: 12 },
  { code: "371", country: "LV", min: 11, max: 12 },
  { code: "372", country: "EE", min: 10, max: 12 },
  { code: "359", country: "BG", min: 11, max: 13 },
  { code: "358", country: "FI", min: 10, max: 13 },
  { code: "351", country: "PT", min: 12, max: 13 },
  { code: "353", country: "IE", min: 11, max: 13 },
  { code: "76", country: "KZ", min: 11, max: 11 },
  { code: "77", country: "KZ", min: 11, max: 11 },
  { code: "48", country: "PL", min: 11, max: 12 },
  { code: "49", country: "DE", min: 11, max: 14 },
  { code: "44", country: "GB", min: 12, max: 13 },
  { code: "43", country: "AT", min: 10, max: 14 },
  { code: "41", country: "CH", min: 11, max: 12 },
  { code: "40", country: "RO", min: 11, max: 12 },
  { code: "39", country: "IT", min: 11, max: 13 },
  { code: "36", country: "HU", min: 10, max: 12 },
  { code: "34", country: "ES", min: 11, max: 12 },
  { code: "33", country: "FR", min: 11, max: 12 },
  { code: "32", country: "BE", min: 10, max: 12 },
  { code: "31", country: "NL", min: 11, max: 12 },
  { code: "30", country: "GR", min: 12, max: 12 },
  { code: "90", country: "TR", min: 12, max: 12 },
  { code: "86", country: "CN", min: 12, max: 13 },
  { code: "81", country: "JP", min: 11, max: 13 },
  { code: "61", country: "AU", min: 11, max: 12 },
  { code: "55", country: "BR", min: 12, max: 13 },
  { code: "1", country: "US", min: 11, max: 11 },
  { code: "7", country: "RU", min: 11, max: 11 },
];

const CALLING_CODES_BY_LENGTH = [...CALLING_CODES].sort((a, b) => b.code.length - a.code.length);

const UA_MOBILE_NINE = /^(39|50|63|66|67|68|73|75|77|91|92|93|94|95|96|97|98|99)/;

function digitsOnly(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

/** Номер із кодом країни, без плюса. Місцевий 0XX… стає 380…. Чужий код не підміняємо на UA. */
export function phoneForFacebook(raw: string | null | undefined): PhoneHit | null {
  let digits = digitsOnly(raw);
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.startsWith("380") && digits.length > 12) digits = digits.slice(0, 12);
  if (digits.length === 10 && digits.startsWith("0")) digits = `380${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith("80")) digits = `3${digits}`;
  if (digits.length === 9 && UA_MOBILE_NINE.test(digits)) digits = `380${digits}`;

  if (digits.length < 8 || digits.length > 15) return null;

  for (const rule of CALLING_CODES_BY_LENGTH) {
    if (!digits.startsWith(rule.code)) continue;
    if (digits.length < rule.min || digits.length > rule.max) continue;
    return { phone: digits, country: rule.country };
  }
  return null;
}

function cleanName(raw: string | null | undefined): string {
  return String(raw || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function spentValue(spent: number | null | undefined): number {
  const n = Number(spent);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function nameScore(row: CsvRow): number {
  return (row.fn ? 1 : 0) + (row.ln ? 1 : 0);
}

export function buildFacebookCustomerListCsv(
  sources: FacebookCustomerSource[]
): FacebookCustomerListResult {
  const byPhone = new Map<string, CsvRow>();
  let skipped = 0;
  let merged = 0;

  for (const source of sources) {
    const hit = phoneForFacebook(source.phone);
    if (!hit) {
      skipped += 1;
      continue;
    }
    const next: CsvRow = {
      phone: hit.phone,
      fn: cleanName(source.firstName),
      ln: cleanName(source.lastName),
      country: hit.country,
      value: spentValue(source.spent),
    };
    const prev = byPhone.get(hit.phone);
    if (!prev) {
      byPhone.set(hit.phone, next);
      continue;
    }
    merged += 1;
    if (next.value > prev.value || (next.value === prev.value && nameScore(next) > nameScore(prev))) {
      byPhone.set(hit.phone, next);
    }
  }

  const rows = [...byPhone.values()].sort((a, b) => {
    const byLn = a.ln.localeCompare(b.ln, "uk");
    if (byLn !== 0) return byLn;
    const byFn = a.fn.localeCompare(b.fn, "uk");
    if (byFn !== 0) return byFn;
    return a.phone.localeCompare(b.phone);
  });

  const lines = ["phone,fn,ln,zip,st,country,value"];
  for (const row of rows) {
    lines.push(
      [row.phone, csvCell(row.fn), csvCell(row.ln), LVIV_ZIP, csvCell(LVIV_REGION), row.country, String(row.value)].join(
        ","
      )
    );
  }

  return {
    csv: `${lines.join("\r\n")}\r\n`,
    rows: rows.length,
    ua: rows.filter((row) => row.country === "UA").length,
    skipped,
    merged,
  };
}
