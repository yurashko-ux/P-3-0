import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { canRevokeEncashmentConfirmation } from "@/lib/finance/encashment-confirmation";
import { isZasadnaPartyTitle } from "@/lib/bank/zasadna-payments-window";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Сховати або повернути платіж ФОП Засадна. Рядок у банку лишається, Платежі його не бачать. */
export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;
  if (!(await canRevokeEncashmentConfirmation(auth))) {
    return NextResponse.json({ ok: false, error: "Сховати платіж може лише розробник" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const hidden = body.hidden === true;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Немає id платежу" }, { status: 400 });
  }

  const statement = await prisma.bankStatementItem.findUnique({
    where: { id },
    select: {
      id: true,
      paymentNumber: true,
      account: {
        select: {
          altegioAccountTitle: true,
          connection: { select: { clientName: true, name: true } },
        },
      },
    },
  });
  if (!statement) {
    return NextResponse.json({ ok: false, error: "Платіж не знайдено" }, { status: 404 });
  }

  const titles = [
    statement.account.altegioAccountTitle,
    statement.account.connection?.clientName,
    statement.account.connection?.name,
  ];
  if (!titles.some((title) => isZasadnaPartyTitle(title))) {
    return NextResponse.json({ ok: false, error: "Кошик лише для рахунку ФОП Засадна" }, { status: 400 });
  }

  const paymentsHiddenAt = hidden ? new Date() : null;
  await prisma.bankStatementItem.update({
    where: { id },
    data: { paymentsHiddenAt },
  });
  console.log(
    `[bank/operations/hide] ${hidden ? "Сховано" : "Повернуто"} платіж ${statement.paymentNumber ?? id} ФОП Засадна`,
  );

  return NextResponse.json({ ok: true, id, paymentsHidden: hidden });
}
