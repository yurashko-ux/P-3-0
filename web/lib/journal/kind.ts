import { isHairExtensionServiceTitle } from "@/lib/direct-state-helper";

export type SalonServiceKind = "consultation" | "hair" | "other";

export function classifyServiceKind(title: string): SalonServiceKind {
  const t = String(title || "").trim();
  if (/консультаці/i.test(t)) return "consultation";
  if (isHairExtensionServiceTitle(t)) return "hair";
  return "other";
}
