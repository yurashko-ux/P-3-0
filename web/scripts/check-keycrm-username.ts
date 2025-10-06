#!/usr/bin/env tsx

import { findCardSimple } from "../lib/keycrm-find";

type CliArgs = {
  social_id?: string;
  username?: string; // застарілий синонім, не показуємо в довідці
  full_name?: string;
  social_name?: string;
  pipeline_id?: number;
  status_id?: number;
  scope?: "campaign" | "global";
  max_pages?: number;
  page_size?: number;
  strategy?: "social" | "title" | "both";
  title_mode?: "exact" | "contains";
};

type Parsed = {
  params: CliArgs;
  errors: string[];
  warnings: string[];
};

const HELP = `
Перевірка пошуку картки в KeyCRM через findCardSimple().

Використання:
  npm run check:keycrm -- <social_id> [інші прапорці]

Основні прапорці:
  --social_id=<value>       Значення contact.social_id (можна передати позиційно).
  --full_name=<value>       Пошук по назві картки «Чат з <ПІБ>».
  --social_name=<value>     Платформа (instagram, telegram, ...).
  --pipeline_id=<number>    Обовʼязковий разом із status_id, якщо scope=campaign.
  --status_id=<number>
  --scope=campaign|global   За замовчуванням global.
  --max_pages=<number>      Кількість сторінок для сканування (1..50).
  --page_size=<number>      Розмір сторінки (1..100).
  --strategy=social|title|both
  --title_mode=exact|contains

Підказки:
  • Якщо передано social_id без social_name, використовується instagram.
  • ManyChat username = contact.social_id, тому логін можна вставити як <social_id>.

Як запустити:
  1. Перейдіть у теку проєкту: cd /шлях/до/P-3-0/web
  2. Запустіть скрипт:    KEYCRM_API_TOKEN=... npm run check:keycrm -- kolachnyk.v

Альтернатива без переходу в теку web (замініть шлях на свій):
  KEYCRM_API_TOKEN=... npm run --prefix /шлях/до/P-3-0/web check:keycrm -- kolachnyk.v

Приклади з повним ім'ям або Telegram:
  KEYCRM_API_TOKEN=... npm run check:keycrm -- --full_name="John Doe"
  KEYCRM_API_TOKEN=... npm run check:keycrm -- --social_id=@test --social_name=telegram
`;

function parseArgs(argv: string[]): Parsed {
  const params: CliArgs = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      return { params: { ...params }, errors: ["help"], warnings };
    }

    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=", 2);
    const key = rawKey as keyof CliArgs;
    const value = rawValue ?? "";

    if (!value) {
      errors.push(`Прапорець --${rawKey} вимагає значення (формат --${rawKey}=...)`);
      continue;
    }

    switch (key) {
      case "social_id":
      case "full_name":
      case "social_name":
      case "scope":
      case "strategy":
      case "title_mode":
        (params as any)[key] = value;
        break;
      case "username":
        (params as any)[key] = value;
        warnings.push("--username застарів, використовуйте --social_id.");
        break;
      case "pipeline_id":
      case "status_id":
      case "max_pages":
      case "page_size": {
        const num = Number(value);
        if (Number.isNaN(num)) {
          errors.push(`Прапорець --${rawKey} очікує число, отримано "${value}"`);
        } else {
          (params as any)[key] = num;
        }
        break;
      }
      default:
        errors.push(`Невідомий прапорець --${rawKey}`);
    }
  }

  if (!params.social_id && positional[0]) {
    params.social_id = positional[0];
  }

  return { params, errors, warnings };
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const parsed = parseArgs(argv);

  if (parsed.errors.includes("help")) {
    console.log(HELP);
    process.exit(0);
  }

  const otherErrors = parsed.errors.filter((e) => e !== "help");
  if (otherErrors.length) {
    console.error("Помилки введення:\n - " + otherErrors.join("\n - "));
    process.exit(1);
  }

  if (parsed.warnings.length) {
    console.warn("Попередження:\n - " + parsed.warnings.join("\n - "));
  }

  if (!parsed.params.social_id && parsed.params.username) {
    parsed.params.social_id = parsed.params.username;
  }

  if (!parsed.params.social_id && !parsed.params.full_name) {
    console.error("Передай хоча б social_id або full_name. Дивись --help для прикладів.");
    process.exit(1);
  }

  if (!parsed.params.social_name && parsed.params.social_id) {
    parsed.params.social_name = "instagram";
  }

  const loggedParams = { ...parsed.params } as Record<string, unknown>;
  delete loggedParams.username;

  console.log("➡️  Викликаємо findCardSimple з параметрами:\n", JSON.stringify(loggedParams, null, 2));

  const result = await findCardSimple(parsed.params);

  console.log("\n⬅️  Відповідь:");
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.error("\n⚠️  Пошук завершився з помилкою (див. поле error/hint вище).");
    process.exit(1);
  }

  const found = result.result;
  if (found) {
    console.log("\n✅ Знайдено картку:");
    console.log(`  • ID: ${found.id}`);
    if (found.title) console.log(`  • Назва: ${found.title}`);
    if (found.contact_social) console.log(`  • Контакт: ${found.contact_social}`);
    if (found.contact_social_name) console.log(`  • Платформа: ${found.contact_social_name}`);
  } else {
    console.log("\nℹ️  Картку не знайдено за переданими параметрами.");
  }
}

main().catch((error) => {
  console.error("Неперехоплена помилка під час виконання скрипта:", error);
  process.exit(1);
});
