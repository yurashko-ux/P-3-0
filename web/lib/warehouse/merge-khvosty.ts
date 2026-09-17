// Група «Хвости» лише в Kresco. Altegio не створюємо, не переносимо і не видаляємо.

import { prisma } from "@/lib/prisma";
import { listAltegioGoodsCategories } from "@/lib/altegio/warehouse-write";

export const KHVOSTY_GROUP_TITLE = "Хвости";

export type MergeKhvostyResult = {
  targetGroupId: string;
  movedKresco: number;
  deletedKrescoGroups: string[];
};

function normalizeGroupTitle(title: string): string {
  return String(title || "")
    .normalize("NFKC")
    .toLocaleLowerCase("uk-UA")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-яіїєґ0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSourceHairTailsGroup(title: string): boolean {
  const n = normalizeGroupTitle(title);
  if (!n) return false;
  if (n === normalizeGroupTitle(KHVOSTY_GROUP_TITLE)) return false;
  if (n.includes("накладн")) return false;
  if ((n.includes("преміум") || n.includes("премиум")) && (n.includes("хвост") || n.includes("хвіст"))) return true;
  if (n.includes("шаньйон") || n.includes("шанйон") || n.includes("шиньон")) return true;
  // «Волосся до 45см.» / «Волосся до 45 см» / без «см»
  if ((n.includes("волосся до") || n.includes("волос до")) && /(40|45|50|60|70|80)/.test(n)) return true;
  return false;
}

export function isKhvostyKrescoGroup(title: string): boolean {
  return normalizeGroupTitle(title) === normalizeGroupTitle(KHVOSTY_GROUP_TITLE);
}

/** Стара категорія Altegio → група Kresco «Хвости». */
export function resolveKrescoGroupTitle(title: string): string {
  return isSourceHairTailsGroup(title) ? KHVOSTY_GROUP_TITLE : String(title || "").trim();
}

export async function ensureKhvostyGroup(): Promise<{ id: string; title: string }> {
  const existing = await prisma.warehouseProductGroup.findFirst({
    where: { title: { equals: KHVOSTY_GROUP_TITLE, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return prisma.warehouseProductGroup.update({
      where: { id: existing.id },
      data: { title: KHVOSTY_GROUP_TITLE, isHair: true, isActive: true, altegioCategoryId: null, sortOrder: -100 },
    });
  }
  const created = await prisma.warehouseProductGroup.create({
    data: {
      title: KHVOSTY_GROUP_TITLE,
      isHair: true,
      altegioCategoryId: null,
      isActive: true,
      sortOrder: -100,
    },
  });
  console.log(`[warehouse/khvosty] Створено групу Kresco «${KHVOSTY_GROUP_TITLE}» id=${created.id}`);
  return created;
}

export async function moveKrescoProductsToKhvosty(targetGroupId: string): Promise<number> {
  const groups = await prisma.warehouseProductGroup.findMany();
  const sourceGroups = groups.filter((group) => isSourceHairTailsGroup(group.title));
  console.log(
    `[warehouse/khvosty] Усі групи (${groups.length}): ${groups.map((g) => `«${g.title}»`).join(" | ")}`,
  );
  console.log(
    `[warehouse/khvosty] Групи-джерела: ${sourceGroups.map((g) => `«${g.title}»`).join(", ") || "немає"}`,
  );

  let moved = 0;
  const sourceIds = sourceGroups.map((g) => g.id).filter((id) => id !== targetGroupId);
  if (sourceIds.length > 0) {
    const byGroup = await prisma.warehouseProduct.updateMany({
      where: { groupId: { in: sourceIds } },
      data: { groupId: targetGroupId, category: KHVOSTY_GROUP_TITLE, isHair: true },
    });
    moved += byGroup.count;
    console.log(`[warehouse/khvosty] updateMany за groupId: ${byGroup.count}`);
  }

  const products = await prisma.warehouseProduct.findMany({
    where: { NOT: { groupId: targetGroupId } },
    include: { group: true },
  });
  for (const product of products) {
    const groupTitle = product.group?.title || product.category || "";
    if (!isSourceHairTailsGroup(groupTitle) && !isSourceHairTailsGroup(product.category || "")) continue;
    await prisma.warehouseProduct.update({
      where: { id: product.id },
      data: {
        groupId: targetGroupId,
        category: KHVOSTY_GROUP_TITLE,
        isHair: true,
      },
    });
    moved += 1;
  }
  console.log(`[warehouse/khvosty] У Kresco перенесено ${moved} карток у «Хвости»`);
  return moved;
}

/** Dual-write нової картки: у Altegio пишемо в стару категорію, групу Altegio не створюємо. */
export async function altegioCategoryIdForKrescoWrite(group: {
  title: string;
  altegioCategoryId: number | null;
}): Promise<number> {
  if (isKhvostyKrescoGroup(group.title) || isSourceHairTailsGroup(group.title)) {
    const existing = await pickExistingAltegioSourceCategoryId();
    if (!existing) {
      throw new Error(
        `Для групи «${KHVOSTY_GROUP_TITLE}» у Altegio лишаються старі категорії. Немає жодної з них, щоб записати нову картку.`,
      );
    }
    return existing;
  }
  if (group.altegioCategoryId && group.altegioCategoryId > 0) return group.altegioCategoryId;
  throw new Error("Немає категорії Altegio для групи");
}

export async function pickExistingAltegioSourceCategoryId(): Promise<number | null> {
  const categories = await listAltegioGoodsCategories();
  const preferred = categories.find((row) => normalizeGroupTitle(row.title) === "преміум хвости");
  if (preferred) return preferred.id;
  const any = categories.find((row) => isSourceHairTailsGroup(row.title));
  return any?.id ?? null;
}

/** Порожні старі групи-джерела. «Хвости» не видаляємо ніколи — навіть порожню, її створили в Kresco. */
export async function deleteEmptySourceKrescoGroups(keepGroupId?: string | null): Promise<string[]> {
  const leftoverGroups = await prisma.warehouseProductGroup.findMany();
  const deleted: string[] = [];
  for (const group of leftoverGroups) {
    if (keepGroupId && group.id === keepGroupId) continue;
    if (isKhvostyKrescoGroup(group.title)) continue;
    if (!isSourceHairTailsGroup(group.title)) continue;
    const liveCount = await prisma.warehouseProduct.count({ where: { groupId: group.id } });
    if (liveCount > 0) {
      console.log(`[warehouse/khvosty] Групу «${group.title}» не видаляємо: ще ${liveCount} товарів`);
      continue;
    }
    try {
      await prisma.warehouseProductGroup.delete({ where: { id: group.id } });
      deleted.push(group.title);
      console.log(`[warehouse/khvosty] Видалено порожню групу Kresco «${group.title}» (Altegio не чіпаємо)`);
    } catch (err) {
      console.warn(`[warehouse/khvosty] Не вдалось видалити «${group.title}»:`, err);
    }
  }
  return deleted;
}

export async function mergeHairTailsIntoKhvosty(): Promise<MergeKhvostyResult> {
  const target = await ensureKhvostyGroup();
  const movedKresco = await moveKrescoProductsToKhvosty(target.id);
  const deletedKrescoGroups = await deleteEmptySourceKrescoGroups(target.id);
  const result: MergeKhvostyResult = {
    targetGroupId: target.id,
    movedKresco,
    deletedKrescoGroups,
  };
  console.log("[warehouse/khvosty] Готово (лише Kresco):", result);
  return result;
}
