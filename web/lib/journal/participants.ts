// Учасники візиту (1–5) і товари в записі.

import { prisma } from "@/lib/prisma";
import { listJournalStaffFromAltegio, hasAssignedPosition } from "./staff";
import { serializeStaffIds } from "./line-staff";

export type ParticipantInput = {
  altegioStaffId: number;
  staffName?: string | null;
  role?: string | null;
  isPrimary?: boolean;
};

export async function replaceAppointmentParticipants(
  appointmentId: string,
  participants: ParticipantInput[],
) {
  const cleaned = participants
    .map((p, i) => ({
      altegioStaffId: Number(p.altegioStaffId) || 0,
      staffName: p.staffName ? String(p.staffName) : null,
      role: p.role ? String(p.role) : "master",
      isPrimary: Boolean(p.isPrimary),
      sortOrder: i,
    }))
    .filter((p) => p.altegioStaffId > 0)
    .slice(0, 5);

  if (cleaned.length === 0) {
    throw new Error("Додайте хоча б одного учасника візиту");
  }
  if (!cleaned.some((p) => p.isPrimary)) {
    cleaned[0].isPrimary = true;
  }
  // Лише один primary
  let seenPrimary = false;
  for (const p of cleaned) {
    if (p.isPrimary) {
      if (seenPrimary) p.isPrimary = false;
      else seenPrimary = true;
    }
  }

  const staff = await listJournalStaffFromAltegio();
  for (const p of cleaned) {
    const hit = staff.find((s) => s.altegioStaffId === p.altegioStaffId);
    if (!hit || !hasAssignedPosition(hit)) {
      throw new Error(`Працівника ${p.altegioStaffId} немає в штаті з посадою`);
    }
    if (!p.staffName) p.staffName = hit.name;
    if (!p.role || p.role === "master") p.role = hit.positionKind;
  }

  await prisma.salonAppointmentParticipant.deleteMany({ where: { appointmentId } });
  await prisma.salonAppointmentParticipant.createMany({
    data: cleaned.map((p) => ({
      appointmentId,
      altegioStaffId: p.altegioStaffId,
      staffName: p.staffName,
      role: p.role || "master",
      isPrimary: p.isPrimary,
      sortOrder: p.sortOrder,
    })),
  });

  const primary = cleaned.find((p) => p.isPrimary) || cleaned[0];
  return primary;
}

export type GoodLineInput = {
  productId: string;
  storageId: string;
  title?: string;
  quantity?: number;
  salePrice?: number;
  altegioGoodId?: number | null;
  staffIds?: number[];
};

export async function replaceAppointmentGoods(appointmentId: string, goods: GoodLineInput[]) {
  const rows: Array<{
    appointmentId: string;
    productId: string;
    storageId: string;
    title: string;
    quantity: number;
    salePrice: number;
    altegioGoodId: number | null;
    staffIdsJson: string | null;
  }> = [];

  for (const g of goods) {
    const productId = String(g.productId || "");
    const storageId = String(g.storageId || "");
    if (!productId || !storageId) continue;
    const product = await prisma.warehouseProduct.findUnique({ where: { id: productId } });
    if (!product || !product.isActive) throw new Error(`Товар не знайдено: ${productId}`);
    const storage = await prisma.warehouseStorage.findUnique({ where: { id: storageId } });
    if (!storage || !storage.isActive) throw new Error(`Склад не знайдено: ${storageId}`);
    const qty = Math.max(0.001, Number(g.quantity) || 1);
    const price = Math.max(0, Number(g.salePrice ?? product.salePrice) || 0);
    const staffIds = Array.isArray(g.staffIds) ? g.staffIds.map(Number).filter((id) => id > 0) : [];
    if (staffIds.length === 0) {
      throw new Error(`У товарі «${g.title || product.title}» має бути хоча б один виконавець`);
    }
    rows.push({
      appointmentId,
      productId,
      storageId,
      title: g.title || product.title,
      quantity: qty,
      salePrice: price,
      altegioGoodId: g.altegioGoodId != null ? Number(g.altegioGoodId) : product.altegioGoodId,
      staffIdsJson: serializeStaffIds(staffIds),
    });
  }

  await prisma.salonAppointmentGoodLine.deleteMany({ where: { appointmentId } });
  if (rows.length > 0) {
    await prisma.salonAppointmentGoodLine.createMany({ data: rows });
  }
  return rows;
}
