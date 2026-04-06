// Чисті форматтери для рядків таблиці Direct (без React-стану)
import type { DirectClient } from "@/lib/direct-types";

export function formatDate(dateStr?: string): string {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return dateStr;
  }
}

/** Короткий рік: 11.11.26 */
export function formatDateShortYear(dateStr?: string): string {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit" });
  } catch {
    return dateStr;
  }
}

export function formatUAHExact(amountUAH: number): string {
  const n = Math.round(amountUAH);
  return `${n.toLocaleString("uk-UA")} грн`;
}

export function formatUAHThousands(amountUAH: number): string {
  const n = Math.round(amountUAH);
  return `${Math.round(n / 1000).toLocaleString("uk-UA")} тис.`;
}

export function shortPersonName(raw?: string | null): string {
  const s = (raw || "").toString().trim();
  if (!s) return "";
  const firstPerson = s.split(",")[0]?.trim() || s;
  const firstWord = firstPerson.split(/\s+/)[0]?.trim();
  return firstWord || firstPerson;
}

export function getFullName(client: DirectClient): string {
  const isBadNamePart = (v?: string) => {
    if (!v) return true;
    const t = v.trim();
    if (!t) return true;
    if (t.includes("{{") || t.includes("}}")) return true;
    if (t.toLowerCase() === "not found") return true;
    return false;
  };
  const parts = [client.firstName, client.lastName].filter((p) => !isBadNamePart(p));
  return parts.length ? parts.join(" ") : "-";
}
