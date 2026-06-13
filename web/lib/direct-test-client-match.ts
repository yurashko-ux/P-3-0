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

function normalizePart(part: string): string {
  return part.trim().toLowerCase();
}

/** Окреме слово імені: «тест», «test», «тестовий», «тестова» тощо. */
function tokenLooksTest(token: string): boolean {
  const t = normalizePart(token);
  if (!t) return false;
  if (t === 'тест' || t === 'test' || t === 'demo') return true;
  // JS \b не працює з кирилицею — перевіряємо префікс/підрядок вручну
  if (/^тест/.test(t) || /^test/.test(t) || /^demo/.test(t)) return true;
  if (/тестов/.test(t)) return true;
  return false;
}

/** Чи рядок (ім'я, username) містить маркер тестового клієнта. */
function partLooksTest(part: string): boolean {
  const p = normalizePart(part);
  if (!p) return false;
  if (/^хочу\s+запис/.test(p)) return true;
  if (/\btest\b/.test(p) || /\bdemo\b/.test(p)) return true;
  const tokens = p.split(/\s+/).filter(Boolean);
  if (tokens.some(tokenLooksTest)) return true;
  // username: missing_instagram_… без маркера в імені — лише токени вище
  return false;
}

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
    if (partLooksTest(part)) return true;
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
