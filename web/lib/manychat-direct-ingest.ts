// Переписку і джерело ліда з ManyChat не пишемо: вхідні вже приходять з Meta.
// Код обробника лишається. Ці прапорці ізолюють запис у Direct.
// MANYCHAT_LEAD_AGENCY_ENABLED=false: джерела (органіка/агенції) не ставимо з ManyChat —
// без ad_id лишається «не визначено», усе інше — лише вручну з дропдауна.

export const MANYCHAT_DIRECT_MESSAGES_ENABLED = false;
export const MANYCHAT_LEAD_AGENCY_ENABLED = false;
