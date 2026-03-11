// web/app/admin/direct/_components/BinotelCallTypeIcon.tsx
// Піктограма типу дзвінка: вхідний/вихідний × успішний/неуспішний (зелений/червоний)

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

  // Вхідний: стрілка вниз ↓ | Вихідний: стрілка вгору ↑
  const path =
    isIncoming
      ? "M12 4v16m0 0l-6-6m6 6l6-6"
      : "M12 20V4m0 0l-6 6m6-6l6 6";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d={path}
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
