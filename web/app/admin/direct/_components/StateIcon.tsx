// web/app/admin/direct/_components/StateIcon.tsx
// Компонент для відображення піктограми стану (емоджі замість SVG — можна копіювати)

"use client";

const STATE_EMOJI: Record<string, string> = {
  client: "👤",
  consultation: "📅",
  message: "💬",
  "new-lead": "💬",
  "consultation-booked": "📅",
  "consultation-past": "📅",
  "consultation-no-show": "❌",
  "consultation-rescheduled": "🔁",
  "all-good": "✅",
  "too-expensive": "💰",
  sold: "🔥",
  lead: "💬",
};

export function StateIcon({ state, size = 36 }: { state: string | null; size?: number }) {
  const emoji = state ? (STATE_EMOJI[state] ?? "💬") : "💬";
  return (
    <span
      className="leading-none inline-flex items-center justify-center"
      style={{ fontSize: `${Math.round(size * 0.86)}px` }}
      aria-hidden
    >
      {emoji}
    </span>
  );
}
