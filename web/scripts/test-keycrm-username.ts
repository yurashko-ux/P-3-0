import { findCardSimple } from "../lib/keycrm-find";

type CardRow = {
  id: number;
  title: string;
  pipeline_id: number;
  status_id: number;
  contact?: {
    social_id?: string | null;
    social_name?: string | null;
  } | null;
};

type MockResponse = {
  data: CardRow[];
  meta?: {
    total?: number;
    per_page?: number;
    current_page?: number;
    last_page?: number;
  } | null;
};

type FetchLogEntry = {
  url: string;
  ok: boolean;
};

type MockScenario = {
  username: string;
  expectedCardId: number | null;
};

const cards: CardRow[] = [
  {
    id: 101,
    title: "Чат з Тестом",
    pipeline_id: 1,
    status_id: 10,
    contact: { social_id: "@demo_user", social_name: "instagram" },
  },
  {
    id: 202,
    title: "Чат з Іншим",
    pipeline_id: 1,
    status_id: 10,
    contact: { social_id: "Another_User", social_name: "instagram" },
  },
];

const mockResponse: MockResponse = {
  data: cards,
  meta: {
    total: cards.length,
    per_page: cards.length,
    current_page: 1,
    last_page: 1,
  },
};

const fetchLog: FetchLogEntry[] = [];

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
  fetchLog.push({ url, ok: true });

  return new Response(JSON.stringify(mockResponse), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

process.env.KEYCRM_API_TOKEN = "dummy-token";

const scenarios: MockScenario[] = [
  { username: "demo_user", expectedCardId: 101 },
  { username: "@Demo_User", expectedCardId: 101 },
  { username: "another_user", expectedCardId: 202 },
  { username: "@unknown", expectedCardId: null },
];

async function run() {
  const outputs: Array<{ username: string; result: any }> = [];

  for (const scenario of scenarios) {
    const result = await findCardSimple({ username: scenario.username });

    const foundId = result.result?.id ?? null;
    const matches = foundId === scenario.expectedCardId;

    outputs.push({ username: scenario.username, result });

    if (!matches) {
      throw new Error(
        `Очікували картку ${scenario.expectedCardId}, але отримали ${foundId} для username=${scenario.username}`
      );
    }
  }

  console.log("Тестові сценарії пройдені. Пошук по username працює очікувано.\n");
  console.log("Запити до API:");
  for (const entry of fetchLog) {
    console.log(` - ${entry.url}`);
  }

  console.log("\nДеталі результатів:");
  for (const output of outputs) {
    console.log(JSON.stringify({ username: output.username, result: output.result }, null, 2));
  }
}

run().catch((error) => {
  console.error("Тест провалився:", error);
  process.exitCode = 1;
});
