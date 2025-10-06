#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { findCardSimple } from "../lib/keycrm-find";

type Card = {
  id: number;
  title: string;
  pipeline_id: number;
  status_id: number;
  contact: {
    social_id: string;
    social_name: string;
    full_name: string;
  };
};

type Page = {
  data: Card[];
  meta: {
    total: number;
    per_page: number;
    current_page: number;
    last_page: number;
  };
};

// Псевдо-дані KeyCRM: один запис з social_id, інший з full_name = username
const SAMPLE_PAGE: Page = {
  data: [
    {
      id: 101,
      title: "№11011",
      pipeline_id: 1,
      status_id: 2,
      contact: {
        social_id: "@kolachnyk.v",
        social_name: "instagram",
        full_name: "Viktoria Kolachnyk",
      },
    },
    {
      id: 202,
      title: "Чат з kolachnyk.v",
      pipeline_id: 1,
      status_id: 2,
      contact: {
        social_id: "@other.user",
        social_name: "instagram",
        full_name: "kolachnyk.v",
      },
    },
  ],
  meta: {
    total: 2,
    per_page: 50,
    current_page: 1,
    last_page: 1,
  },
};

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const allowedUrls = new Set<string>([
  "/v1/pipelines/cards?page=1&per_page=50",
  "/v1/pipelines/cards?page[number]=1&page[size]=50",
]);

globalThis.fetch = async (input: any): Promise<Response> => {
  const url = typeof input === "string" ? input : input.toString();
  const parsed = new URL(url);
  const key = `${parsed.pathname}${parsed.search}`;

  if (!allowedUrls.has(key)) {
    throw new Error(`Неочікуваний запит до KeyCRM: ${url}`);
  }

  return jsonResponse(SAMPLE_PAGE);
};

// гарантуємо, що перевірка токена не впаде
process.env.KEYCRM_API_TOKEN = process.env.KEYCRM_API_TOKEN || "test-token";

async function testSocialIdMatch() {
  const response = await findCardSimple({
    social_id: "kolachnyk.v",
    social_name: "instagram",
    strategy: "social",
    scope: "global",
    max_pages: 1,
    page_size: 50,
  });

  assert.equal(response.ok, true, "Очікуємо успішну відповідь");
  assert.ok(response.result, "Повинен бути знайдений збіг за social_id");
  assert.equal(response.result?.id, 101, "Повинна повернутися картка 101");
  assert.ok(
    response.result?.matched_by?.includes("social_id"),
    "Очікуємо позначку matched_by=social_id",
  );
}

async function testFullNameMatch() {
  const response = await findCardSimple({
    full_name: "kolachnyk.v",
    strategy: "full_name",
    title_mode: "exact",
    scope: "global",
    max_pages: 1,
    page_size: 50,
  });

  assert.equal(response.ok, true, "Очікуємо успішну відповідь");
  assert.ok(response.result, "Повинен бути знайдений збіг за full_name");
  assert.equal(response.result?.id, 202, "Повинна повернутися картка 202");
  assert.ok(
    response.result?.matched_by?.includes("full_name"),
    "Очікуємо позначку matched_by=full_name",
  );
}

async function main() {
  await testSocialIdMatch();
  await testFullNameMatch();
  console.log("✅ Перевірки social_id та full_name відпрацювали успішно.");
}

main().catch((error) => {
  console.error("❌ Тестовий сценарій впав:", error);
  process.exit(1);
});
