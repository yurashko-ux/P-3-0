// web/lib/direct-test-client-match.ts
// Визначення тестових карток Direct за ім'ям / username (для масового видалення).

export type TestClientMatchInput = {
  firstName?: string | null;
  lastName?: string | null;
  instagramUsername?: string | null;
};

/** Маркери тестових імен (регістронезалежно). */
const TEST_NAME_REGEXES: RegExp[] = [
  /\bтест\b/i,
  /\btest\b/i,
  /тестов/i,
  /^хочу\s+запис/i,
  /^demo\b/i,
  /\bdemo\b/i,
];

function collectNameParts(client: TestClientMatchInput): string[] {
  const fullName = [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
  const ig = (client.instagramUsername || '').replace(/^@/, '').trim();
  return [client.firstName, client.lastName, fullName, ig]
    .map((s) => (s || '').trim())
    .filter(Boolean);
}

/** Чи картка виглядає як тестова (Тест, test, тестов, demo, «Хочу записатись» тощо). */
export function isDirectTestClientByName(client: TestClientMatchInput): boolean {
  for (const part of collectNameParts(client)) {
    for (const re of TEST_NAME_REGEXES) {
      if (re.test(part)) return true;
    }
  }
  return false;
}

export function formatDirectClientDisplayName(client: TestClientMatchInput): string {
  const fromName = [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
  return fromName || client.instagramUsername || '—';
}
