// web/app/admin/direct/_components/BinotelCallTypeIcon.tsx
// Піктограма типу дзвінка: вхідний/вихідний × успішний/неуспішний (зелений/червоний)
// Трикутники: вхідний = ↓ (tip вниз), вихідний = ↑ (tip вгору)

interface BinotelCallTypeIconProps {
  callType: string;
  success: boolean;
  size?: number;
  className?: string;
}

const SUCCESS_COLOR = "#16a34a"; // green-600
const FAIL_COLOR = "#dc2626"; // red-600

export function BinotelCallTypeIcon({
  callType,
  success,
  size = 18,
  className = "",
}: BinotelCallTypeIconProps) {
  const color = success ? SUCCESS_COLOR : FAIL_COLOR;
  const isIncoming = callType === "incoming";

  // Вхідний: трикутник вниз (tip внизу) | Вихідний: трикутник вгору (tip вгорі)
  const points = isIncoming
    ? "20,20 180,20 100,180"
    : "100,20 20,180 180,180";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <polygon points={points} fill={color} />
    </svg>
  );
}
