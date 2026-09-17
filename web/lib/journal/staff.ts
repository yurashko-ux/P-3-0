// Штат журналу: актуальні працівники філії Altegio (не Direct-майстри).
// Те саме вікно, що https://app.alteg.io/settings/sidebar/staff/{companyId}?fired=0&deleted=0

import { altegioFetch } from "@/lib/altegio/client";
import { resolveJournalCompanyId } from "./company-id";

export type JournalStaffKind = "master" | "assistant" | "admin" | "other";

export type JournalStaff = {
  id: string;
  name: string;
  altegioStaffId: number;
  positionTitle: string;
  positionKind: JournalStaffKind;
};

const KIND_ORDER: Record<JournalStaffKind, number> = {
  master: 0,
  assistant: 1,
  admin: 2,
  other: 3,
};

function unwrapList(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data;
  const inner = obj.data;
  if (inner && typeof inner === "object") {
    if (Array.isArray((inner as any).staff)) return (inner as any).staff;
    if (Array.isArray((inner as any).data)) return (inner as any).data;
  }
  if (Array.isArray((obj as any).staff)) return (obj as any).staff;
  return [];
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function positionTitleOf(item: any): string {
  const pos = item?.position;
  const title =
    (typeof pos === "object" && pos
      ? pos.title || pos.name || pos.specialization
      : null) ||
    item?.position_title ||
    item?.specialization ||
    item?.position_name ||
    "";
  return String(title || "").trim();
}

export function classifyStaffPosition(title: string): JournalStaffKind {
  const t = String(title || "").toLowerCase();
  if (/майстер|мастер|master/.test(t)) return "master";
  if (/асист|ассист|assist/.test(t)) return "assistant";
  if (/адмін|админ|admin/.test(t)) return "admin";
  return "other";
}

/** Є посада салону (не «без посади», не власник). */
export function hasAssignedPosition(row: JournalStaff): boolean {
  if (row.positionKind === "other") return false;
  const t = String(row.positionTitle || "").trim().toLowerCase();
  if (!t || t === "без посади") return false;
  if (/власник|owner/.test(t)) return false;
  return true;
}

export function isCalendarMaster(row: JournalStaff): boolean {
  return row.positionKind === "master";
}

function isCurrentEmployee(item: any): boolean {
  if (isTruthyFlag(item?.fired) || isTruthyFlag(item?.is_fired) || isTruthyFlag(item?.dismissed)) {
    return false;
  }
  if (isTruthyFlag(item?.deleted) || isTruthyFlag(item?.is_deleted)) {
    return false;
  }
  return true;
}

function mapStaff(item: any, positions: Map<number, string>): JournalStaff | null {
  const id = Number(item?.id ?? item?.staff_id ?? 0);
  const name = String(
    item?.name ||
      item?.title ||
      item?.display_name ||
      [item?.last_name, item?.first_name].filter(Boolean).join(" ") ||
      "",
  ).trim();
  if (!(id > 0) || !name) return null;
  const positionId = Number(item?.position_id ?? item?.position?.id ?? 0);
  const positionTitle = positionTitleOf(item) || (positionId > 0 ? positions.get(positionId) : "") || "";
  return {
    id: String(id),
    name,
    altegioStaffId: id,
    positionTitle: positionTitle || "без посади",
    positionKind: classifyStaffPosition(positionTitle),
  };
}

async function listPositions(companyId: number): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (const path of [`/positions/${companyId}`, `/company/${companyId}/positions`]) {
    try {
      const raw = await altegioFetch<unknown>(path);
      const list = unwrapList(raw);
      for (const item of list) {
        const id = Number(item?.id ?? 0);
        const title = String(item?.title ?? item?.name ?? "").trim();
        if (id > 0 && title) map.set(id, title);
      }
      if (map.size > 0) {
        console.log(`[journal/staff] Посади Altegio: ${map.size} (${path})`);
        return map;
      }
    } catch (err) {
      console.warn(`[journal/staff] Не вдалося прочитати посади ${path}:`, err instanceof Error ? err.message : err);
    }
  }
  return map;
}

export async function listJournalStaffFromAltegio(): Promise<JournalStaff[]> {
  const companyId = resolveJournalCompanyId();
  const positions = await listPositions(companyId);
  const paths = [
    `/staff/${companyId}`,
    `/company/${companyId}/staff`,
    `/staff/${companyId}?fired=0`,
  ];
  for (const path of paths) {
    try {
      const raw = await altegioFetch<unknown>(path);
      const list = unwrapList(raw);
      const rows = list
        .filter(isCurrentEmployee)
        .map((item) => mapStaff(item, positions))
        .filter((row): row is JournalStaff => Boolean(row));
      if (rows.length > 0) {
        rows.sort((a, b) => {
          const kind = KIND_ORDER[a.positionKind] - KIND_ORDER[b.positionKind];
          if (kind !== 0) return kind;
          return a.name.localeCompare(b.name, "uk");
        });
        console.log(
          `[journal/staff] Працівники Altegio: ${rows.length} (${path}) ` +
            rows.map((s) => `${s.name} [${s.positionTitle}]`).join(", "),
        );
        return rows;
      }
      if (raw && typeof raw === "object") {
        console.warn(`[journal/staff] Порожній штат ${path}, keys=${Object.keys(raw as object).join(",")}`);
      }
    } catch (err) {
      console.warn(`[journal/staff] Не вдалося прочитати ${path}:`, err instanceof Error ? err.message : err);
    }
  }
  throw new Error("Altegio не повернув штат філії. Перевірте права GET /staff/{companyId}.");
}
