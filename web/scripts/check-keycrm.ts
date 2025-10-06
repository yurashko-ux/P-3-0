#!/usr/bin/env tsx

import { findCardSimple } from "../lib/keycrm-find";

type Scope = "campaign" | "global";
type TitleMode = "exact" | "contains";

type CliArgs = {
  instagram?: string;
  social_id?: string;
  full_name?: string;
  social_name?: string;
  pipeline_id?: number;
  status_id?: number;
  scope?: Scope;
  max_pages?: number;
  page_size?: number;
  title_mode?: TitleMode;
  only?: "social" | "full_name" | "both";
};

type Parsed = {
  params: CliArgs;
  errors: string[];
  help: boolean;
};

const HELP = `
Перевірка пошуку картки в KeyCRM через findCardSimple().

Використання:
  npm run check:keycrm -- <instagram_username> [прапорці]

Аргументи:
  <instagram_username>       Логін з Instagram (підставиться у social_id та full_name).

Основні прапорці:
  --instagram=<value>        Те ж саме, що позиційний аргумент.
  --social_id=<value>        Використати конкретний contact.social_id.
  --full_name=<value>        Використати конкретний contact.full_name/назву картки.
  --social_name=<value>      Платформа (instagram, telegram, ...). За замовчуванням instagram.
  --pipeline_id=<number>     Обовʼязковий разом зі status_id, якщо scope=campaign.
  --status_id=<number>
  --scope=campaign|global    За замовчуванням global.
  --max_pages=<number>       Кількість сторінок для сканування (1..50).
  --page_size=<number>       Розмір сторінки (1..100).
  --title_mode=exact|contains  Режим пошуку назви картки для full_name.
  --only=social|full_name|both  Виконати лише конкретні перевірки (дефолт both).

Сценарій виконує дві спроби:
  1. Пошук за contact.social_id (Instagram username з "@" та без).
  2. Пошук за contact.full_name / назвою картки.

Як запустити з кореня репозиторію:
  cd P-3-0/web && KEYCRM_API_TOKEN=... npm run check:keycrm -- kolachnyk.v

Без переходу у теку web (замініть шлях на свій):
  KEYCRM_API_TOKEN=... npm run --prefix /шлях/до/P-3-0/web check:keycrm -- kolachnyk.v

HTTP-посилання (після запуску Next.js локально на 3000 порту):
  http://localhost:3000/api/keycrm/check?username=kolachnyk.v
`;

function parseArgs(argv: string[]): Parsed {
  const params: CliArgs = {};
  const errors: string[] = [];
  let help = false;

  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=", 2);
    const value = rawValue ?? "";

    if (!value) {
      errors.push(`Прапорець --${rawKey} вимагає значення (формат --${rawKey}=...)`);
      continue;
    }

    switch (rawKey) {
      case "instagram":
      case "social_id":
      case "full_name":
      case "social_name":
      case "scope":
      case "title_mode":
      case "only":
        (params as any)[rawKey] = value;
        break;
      case "pipeline_id":
      case "status_id":
      case "max_pages":
      case "page_size": {
        const num = Number(value);
        if (Number.isNaN(num)) {
          errors.push(`Прапорець --${rawKey} очікує число, отримано "${value}"`);
        } else {
          (params as any)[rawKey] = num;
        }
        break;
      }
      default:
        errors.push(`Невідомий прапорець --${rawKey}`);
    }
  }

  if (positional[0]) {
    params.instagram = positional[0];
  }

  return { params, errors, help };
}

function ensureEnum<T extends string>(value: string | undefined, allowed: readonly T[], flag: string) {
  if (!value) return undefined;
  if (allowed.includes(value as T)) return value as T;
  throw new Error(`Непідтримуване значення для --${flag}: ${value}`);
}

async function runAttempt(label: string, params: Record<string, unknown>) {
  console.log(`\n=== ${label} ===`);
  console.log("➡️  Параметри:");
  console.log(JSON.stringify(params, null, 2));

  const result = await findCardSimple(params as any);

  console.log("\n⬅️  Відповідь:");
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.error("\n❌ Спроба завершилася помилкою (див. поля error/hint вище).");
    return { ok: false, matched: false };
  }

  if (result.result) {
    console.log("\n✅ Картку знайдено. Деталі:");
    console.log(`  • ID: ${result.result.id}`);
    if (result.result.title) console.log(`  • Назва: ${result.result.title}`);
    if (result.result.contact_social) console.log(`  • contact.social_id: ${result.result.contact_social}`);
    if (result.result.contact_full_name) console.log(`  • contact.full_name: ${result.result.contact_full_name}`);
    if (Array.isArray(result.result.matched_by) && result.result.matched_by.length) {
      console.log(`  • Спрацювали ключі: ${result.result.matched_by.join(", ")}`);
    }
    return { ok: true, matched: true };
  }

  console.log("\nℹ️  Картку не знайдено за цим ключем.");
  return { ok: true, matched: false };
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

  if (parsed.help || argv.length === 0) {
    console.log(HELP);
    return;
  }

  if (parsed.errors.length) {
    console.error("Помилки введення:\n - " + parsed.errors.join("\n - "));
    process.exit(1);
  }

  const only = ensureEnum(parsed.params.only, ["social", "full_name", "both"], "only") || "both";
  const scope = ensureEnum(parsed.params.scope, ["campaign", "global"], "scope");
  const title_mode = ensureEnum(parsed.params.title_mode, ["exact", "contains"], "title_mode");

  const instagram = parsed.params.instagram?.trim();
  const social_id = (parsed.params.social_id ?? instagram)?.trim();
  const full_name = (parsed.params.full_name ?? instagram)?.trim();

  if (!social_id && !full_name) {
    console.error("Передай Instagram username (позиційно або через --instagram) чи явні --social_id/--full_name.");
    process.exit(1);
  }

  const shared = {
    social_name: parsed.params.social_name?.trim() || (social_id ? "instagram" : undefined),
    pipeline_id: parsed.params.pipeline_id,
    status_id: parsed.params.status_id,
    max_pages: parsed.params.max_pages,
    page_size: parsed.params.page_size,
    title_mode,
    scope,
  };

  const attempts: Array<{ label: string; params: Record<string, unknown> }> = [];

  if (social_id && (only === "both" || only === "social")) {
    attempts.push({
      label: "Пошук за contact.social_id",
      params: {
        ...shared,
        social_id,
        strategy: "social",
      },
    });
  }

  if (full_name && (only === "both" || only === "full_name")) {
    attempts.push({
      label: "Пошук за contact.full_name / назвою картки",
      params: {
        ...shared,
        full_name,
        strategy: "full_name",
      },
    });
  }

  if (!attempts.length) {
    console.error("Немає жодної спроби для виконання (перевір параметри --only, --social_id, --full_name).");
    process.exit(1);
  }

  let hadError = false;
  let matched = false;

  for (const attempt of attempts) {
    try {
      const res = await runAttempt(attempt.label, attempt.params);
      hadError = hadError || !res.ok;
      matched = matched || res.matched;
    } catch (error) {
      hadError = true;
      console.error(`\n❌ Помилка при виконанні спроби "${attempt.label}":`, error);
    }
  }

  if (hadError) {
    process.exit(1);
  }

  if (!matched) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error("Неперехоплена помилка під час виконання скрипта:", error);
  process.exit(1);
});
