// Каталог складу: групи ↔ категорії Altegio, створення карток.

import { prisma } from "@/lib/prisma";
import {
  createAltegioGood,
  createAltegioGoodsCategory,
  listAltegioGoodsCategories,
} from "@/lib/altegio/warehouse-write";
import { isKhvostyKrescoGroup, isSourceHairTailsGroup, altegioCategoryIdForKrescoWrite } from "./merge-khvosty";

function isHairGroupTitle(title: string): boolean {
  const t = title.toLowerCase();
  return /волос|хвіст|хвост|зріз|накладк|hair|tail|weft/.test(t);
}

export async function listWarehouseGroups() {
  return prisma.warehouseProductGroup.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });
}

export async function ensureGroupFromCategory(params: {
  title: string;
  altegioCategoryId?: number | null;
  isHair?: boolean;
}) {
  const title = String(params.title || "").trim();
  if (!title) return null;

  if (params.altegioCategoryId && params.altegioCategoryId > 0) {
    const byAltegio = await prisma.warehouseProductGroup.findUnique({
      where: { altegioCategoryId: params.altegioCategoryId },
    });
    if (byAltegio) {
      if (byAltegio.title !== title || byAltegio.isHair !== (params.isHair ?? byAltegio.isHair)) {
        return prisma.warehouseProductGroup.update({
          where: { id: byAltegio.id },
          data: { title, isHair: params.isHair ?? isHairGroupTitle(title), isActive: true },
        });
      }
      return byAltegio;
    }
  }

  const existing = await prisma.warehouseProductGroup.findFirst({
    where: { title, isActive: true },
  });
  if (existing) {
    if (params.altegioCategoryId && !existing.altegioCategoryId) {
      return prisma.warehouseProductGroup.update({
        where: { id: existing.id },
        data: { altegioCategoryId: params.altegioCategoryId, isHair: params.isHair ?? existing.isHair },
      });
    }
    return existing;
  }

  return prisma.warehouseProductGroup.create({
    data: {
      title,
      isHair: params.isHair ?? isHairGroupTitle(title),
      altegioCategoryId: params.altegioCategoryId && params.altegioCategoryId > 0 ? params.altegioCategoryId : null,
      isActive: true,
    },
  });
}

export async function createWarehouseGroup(title: string, isHair?: boolean) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Вкажіть назву групи");
  const created = await prisma.warehouseProductGroup.create({
    data: {
      title: trimmed,
      isHair: isHair ?? isHairGroupTitle(trimmed),
      isActive: true,
    },
  });
  if (isKhvostyKrescoGroup(trimmed) || isSourceHairTailsGroup(trimmed)) {
    console.log(`[warehouse/catalog] Групу «${trimmed}» лишаємо лише в Kresco, категорію Altegio не створюємо`);
    return created;
  }
  try {
    const altegio = await ensureGroupAltegioCategory(created.id);
    return altegio;
  } catch (err) {
    console.warn(`[warehouse/catalog] Групу «${trimmed}» збережено, категорія Altegio не створилась:`, err);
    return created;
  }
}

export async function ensureGroupAltegioCategory(groupId: string) {
  const group = await prisma.warehouseProductGroup.findUnique({ where: { id: groupId } });
  if (!group) throw new Error("Групу не знайдено");
  if (isKhvostyKrescoGroup(group.title) || isSourceHairTailsGroup(group.title)) {
    return group;
  }
  if (group.altegioCategoryId && group.altegioCategoryId > 0) return group;

  const categories = await listAltegioGoodsCategories();
  const match = categories.find((row) => row.title.trim().toLowerCase() === group.title.trim().toLowerCase());
  if (match) {
    return prisma.warehouseProductGroup.update({
      where: { id: group.id },
      data: { altegioCategoryId: match.id },
    });
  }
  const created = await createAltegioGoodsCategory(group.title);
  return prisma.warehouseProductGroup.update({
    where: { id: group.id },
    data: { altegioCategoryId: created.id },
  });
}

export async function nextWarehouseSku(): Promise<number> {
  const max = await prisma.warehouseProduct.aggregate({ _max: { sku: true } });
  return (max._max.sku || 0) + 1;
}

export async function createCatalogProduct(input: {
  title: string;
  groupId: string;
  lengthCm?: number | null;
  weightGrams?: number | null;
  isHair?: boolean;
  costUsd?: number;
  costUah?: number;
  createdBy?: string | null;
}) {
  const title = input.title.trim();
  if (!title) throw new Error("Вкажіть назву товару");
  const group = await ensureGroupAltegioCategory(input.groupId);
  const categoryId = await altegioCategoryIdForKrescoWrite(group);

  const isHair = input.isHair ?? group.isHair;
  const costUah = Number(input.costUah) || 0;
  const altegio = await createAltegioGood({
    title,
    categoryId,
    unit: "шт",
    costUah,
    comment: [
      input.lengthCm ? `${input.lengthCm} см` : "",
      input.weightGrams ? `${input.weightGrams} г` : "",
    ]
      .filter(Boolean)
      .join(", "),
  });

  const product = await prisma.warehouseProduct.create({
    data: {
      sku: altegio.id,
      title,
      category: group.title,
      groupId: group.id,
      unit: "шт",
      costPerUnit: costUah,
      costUsd: Number(input.costUsd) || 0,
      isHair,
      lengthCm: input.lengthCm || null,
      weightGrams: input.weightGrams || null,
      altegioGoodId: altegio.id,
      isActive: true,
    },
  });
  console.log(`[warehouse/catalog] Картка ${product.sku} «${title}» createdBy=${input.createdBy || "—"}`);
  return product;
}

export async function searchWarehouseProducts(q: string, limit = 40) {
  const query = q.trim();
  const skuNum = Number(query);
  return prisma.warehouseProduct.findMany({
    where: {
      isActive: true,
      OR: [
        ...(Number.isFinite(skuNum) && skuNum > 0 ? [{ sku: skuNum }, { altegioGoodId: skuNum }] : []),
        { title: { contains: query, mode: "insensitive" as const } },
        { category: { contains: query, mode: "insensitive" as const } },
      ],
    },
    include: { group: true },
    orderBy: { title: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
}

export async function listWarehouseCatalog(params: { q?: string; groupId?: string; hair?: "all" | "yes" | "no" }) {
  const q = String(params.q || "").trim();
  const skuNum = Number(q);
  return prisma.warehouseProduct.findMany({
    where: {
      isActive: true,
      ...(params.groupId ? { groupId: params.groupId } : {}),
      ...(params.hair === "yes" ? { isHair: true } : params.hair === "no" ? { isHair: false } : {}),
      ...(q
        ? {
            OR: [
              ...(Number.isFinite(skuNum) && skuNum > 0 ? [{ sku: skuNum }] : []),
              { title: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: { group: true },
    orderBy: [{ sku: "asc" }, { title: "asc" }],
    take: 2000,
  });
}
