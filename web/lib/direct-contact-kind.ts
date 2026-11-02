/**
 * Наскрізне правило UI: лід vs клієнт (бейдж + кнопка в історії Instagram/Telegram).
 * Збігається з аудиторіями Переписок:
 * - лід: KPI-лід без консультації і без платної послуги
 * - клієнт: є активна консультація або платний запис / візити
 *
 * Не залежить від того, з якого розділу відкрили модалку.
 */

export type DirectContactKind = "lead" | "client";

export type DirectContactKindInput = {
  consultationBookingDate?: string | Date | null;
  consultationDeletedInAltegio?: boolean | null;
  paidServiceDate?: string | Date | null;
  signedUpForPaidService?: boolean | null;
  signedUpForPaidServiceAfterConsultation?: boolean | null;
  visits?: number | null;
  includeInNewLeadsKpi?: boolean | null;
};

export function resolveDirectContactKind(client: DirectContactKindInput | null | undefined): DirectContactKind {
  if (!client) return "lead";

  const hasConsultation =
    !!client.consultationBookingDate && client.consultationDeletedInAltegio !== true;
  if (hasConsultation) return "client";

  if (client.paidServiceDate) return "client";
  if (client.signedUpForPaidService || client.signedUpForPaidServiceAfterConsultation) {
    return "client";
  }
  if (typeof client.visits === "number" && client.visits > 0) return "client";

  return "lead";
}
