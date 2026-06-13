// web/lib/direct-test-client-match.ts
// Визначення тестових карток Direct за ім'ям / username (для масового видалення).

export type TestClientMatchInput = {
  firstName?: string | null;
  lastName?: string | null;
  instagramUsername?: string | null;
};

export type TestClientVisitSignalInput = TestClientMatchInput & {
  consultationBookingDate?: string | Date | null;
  consultationAttended?: boolean | null;
  consultationMasterName?: string | null;
  paidServiceDate?: string | Date | null;
  paidServiceAttended?: boolean | null;
  signedUpForPaidService?: boolean | null;
  consultationDeletedInAltegio?: boolean | null;
  paidServiceDeletedInAltegio?: boolean | null;
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

/** Чи є активна колонка «Консультація» (дата візиту, не лише прапорець видалення). */
export function hasActiveConsultationInDirect(client: TestClientVisitSignalInput): boolean {
  if (client.consultationDeletedInAltegio === true) return false;
  return Boolean(client.consultationBookingDate);
}

/** Чи є активна колонка «Запис» (дата або signedUpForPaidService). */
export function hasActiveBookingInDirect(client: TestClientVisitSignalInput): boolean {
  if (client.paidServiceDeletedInAltegio === true) return false;
  return Boolean(client.paidServiceDate) || client.signedUpForPaidService === true;
}

/** Чи є хоча б консультація або запис у таблиці Direct. */
export function hasActiveConsultationOrBooking(client: TestClientVisitSignalInput): boolean {
  return hasActiveConsultationInDirect(client) || hasActiveBookingInDirect(client);
}

/**
 * Кандидат на масове видалення: тестове ім'я/username І немає активних консультації/запису.
 * «Видалено в Altegio» (прапорець без дати) — вважаємо порожнім.
 */
export function isDeletableTestClientWithoutVisits(client: TestClientVisitSignalInput): boolean {
  return isDirectTestClientByName(client) && !hasActiveConsultationOrBooking(client);
}

export function formatDirectClientDisplayName(client: TestClientMatchInput): string {
  const fromName = [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
  return fromName || client.instagramUsername || '—';
}
