#!/usr/bin/env tsx

import { findCardSimple } from "../lib/keycrm-find";

type CliArgs = {
  username?: string;
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
};

const HELP = `\nПеревірка пошуку картки в KeyCRM через findCardSimple().\n\nВикористання:\n  npm run check:username -- <username> [інші прапорці]\n\nОсновні прапорці:\n  --username=<value>        Instagram username (можна передати як позиційний аргумент).\n  --full_name=<value>       Пошук по назві картки «Чат з <ПІБ>».\n  --social_name=<value>     Платформа (instagram, telegram, ...).\n  --pipeline_id=<number>    Обовʼязковий разом із status_id, якщо scope=campaign.\n  --status_id=<number>\n  --scope=campaign|global   За замовчуванням global.\n  --max_pages=<number>      Кількість сторінок для сканування (1..50).\n  --page_size=<number>      Розмір сторінки (1..100).\n  --strategy=social|title|both\n  --title_mode=exact|contains\n\nПідказки:\n  • Якщо передано username без social_name, використовується instagram.\n\nЯк запустити:\n  1. Перейдіть у теку проєкту: cd /шлях/до/P-3-0/web\n  2. Запустіть скрипт:    KEYCRM_API_TOKEN=... npm run check:username -- kolachnyk.v\n\nАльтернатива без переходу в теку web (замініть шлях на свій):\n  KEYCRM_API_TOKEN=... npm run --prefix /шлях/до/P-3-0/web check:username -- kolachnyk.v\n\nІнші приклади:\n  KEYCRM_API_TOKEN=... npm run check:username -- --username=@test --social_name=telegram\n`;

function parseArgs(argv: string[]): Parsed {
  const params: CliArgs = {};
  const errors: string[] = [];
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      return { params: { ...params, username: params.username }, errors: ["help"] };
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
      case "username":
      case "full_name":
      case "social_name":
      case "scope":
      case "strategy":
      case "title_mode":
        (params as any)[key] = value;
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

  if (!params.username && positional[0]) {
    params.username = positional[0];
  }

  return { params, errors };
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

  if (!parsed.params.username && !parsed.params.full_name) {
    console.error("Передай хоча б username або full_name. Дивись --help для прикладів.");
    process.exit(1);
  }

  if (!parsed.params.social_name && parsed.params.username) {
    parsed.params.social_name = "instagram";
  }

  console.log("➡️  Викликаємо findCardSimple з параметрами:\n", JSON.stringify(parsed.params, null, 2));

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
