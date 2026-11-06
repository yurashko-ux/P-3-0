// Онлайн-запис (/book) наразі вимкнено: сторінка й API віддають 404, картку в адмінці сховано.
// Увімкнути: NEXT_PUBLIC_ONLINE_BOOKING_ENABLED=1 (NEXT_PUBLIC — бо картка в клієнтському компоненті).

export function isOnlineBookingEnabled(): boolean {
  const v = String(process.env.NEXT_PUBLIC_ONLINE_BOOKING_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}
