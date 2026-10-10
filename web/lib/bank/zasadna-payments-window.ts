/**
 * ФОП Засадна: у розділі Платежі історія лише з 09.10.2026.
 * Раніші рухи на рахунку є, але це не кошти салону. Розділ Банк їх і далі показує.
 */
export const ZASADNA_PAYMENTS_FROM_KYIV_DAY = "2026-10-09";

/** 09.10.2026 00:00 Europe/Kyiv. */
export const ZASADNA_PAYMENTS_FROM_UTC = new Date("2026-10-08T21:00:00.000Z");

export function isZasadnaPartyTitle(title: string | null | undefined): boolean {
  return (title || "").toLowerCase().includes("засадн");
}

/** true — платіж Засадної раніше вікна, його не показуємо і не зводимо в Платежах. */
export function isZasadnaPaymentHiddenInPayments(
  titles: Array<string | null | undefined>,
  kyivDay: string,
): boolean {
  if (kyivDay >= ZASADNA_PAYMENTS_FROM_KYIV_DAY) return false;
  return titles.some((title) => isZasadnaPartyTitle(title));
}

/** Платіж, який розробник сховав кошиком, у Платежі і розрахунки не входить. */
export const PAYMENTS_VISIBLE_STATEMENT = { paymentsHiddenAt: null } as const;

/** Додаткова умова вибірки банківської виписки для Платежів. */
export const ZASADNA_PAYMENTS_HISTORY_OR = [
  { time: { gte: ZASADNA_PAYMENTS_FROM_UTC } },
  {
    account: {
      NOT: {
        OR: [
          { altegioAccountTitle: { contains: "асадн", mode: "insensitive" as const } },
          {
            connection: {
              is: {
                OR: [
                  { clientName: { contains: "асадн", mode: "insensitive" as const } },
                  { name: { contains: "асадн", mode: "insensitive" as const } },
                ],
              },
            },
          },
        ],
      },
    },
  },
];
