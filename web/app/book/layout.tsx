import { notFound } from "next/navigation";
import { isOnlineBookingEnabled } from "@/lib/booking/enabled";

export const dynamic = "force-dynamic";

export default function BookLayout({ children }: { children: React.ReactNode }) {
  if (!isOnlineBookingEnabled()) notFound();
  return <>{children}</>;
}
