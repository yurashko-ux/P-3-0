import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  diagnoseAltegioAccountMatch,
  fetchAltegioAccounts,
} from "@/lib/altegio/accounts";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getLast4(value: string | null): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  return digits.slice(-4) || "—";
}

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const [altegioAccounts, bankAccounts] = await Promise.all([
      fetchAltegioAccounts(),
      prisma.bankAccount.findMany({
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          externalId: true,
          balance: true,
          currencyCode: true,
          type: true,
          iban: true,
          maskedPan: true,
          altegioAccountId: true,
          altegioAccountTitle: true,
          altegioBalance: true,
          altegioBalanceUpdatedAt: true,
          altegioSyncError: true,
          connection: {
            select: {
              id: true,
              name: true,
              clientName: true,
              provider: true,
            },
          },
        },
      }),
    ]);

    const items = bankAccounts.map((bankAccount) => {
      const match = diagnoseAltegioAccountMatch(bankAccount, altegioAccounts);
      return {
        bankAccountId: bankAccount.id,
        connectionId: bankAccount.connection.id,
        provider: bankAccount.connection.provider,
        connectionName: bankAccount.connection.name,
        clientName: bankAccount.connection.clientName,
        externalId: bankAccount.externalId,
        currencyCode: bankAccount.currencyCode,
        type: bankAccount.type,
        accountLast4:
          getLast4(bankAccount.maskedPan) !== "—"
            ? getLast4(bankAccount.maskedPan)
            : getLast4(bankAccount.iban),
        savedMatch: {
          altegioAccountId: bankAccount.altegioAccountId,
          altegioAccountTitle: bankAccount.altegioAccountTitle,
          altegioBalance: bankAccount.altegioBalance?.toString() ?? null,
          altegioBalanceUpdatedAt: bankAccount.altegioBalanceUpdatedAt?.toISOString() ?? null,
          altegioSyncError: bankAccount.altegioSyncError,
        },
        bankBalance: bankAccount.balance.toString(),
        diagnostics: {
          inputTokens: match.inputTokens,
          matchedTokens: match.matchedTokens,
          matchSource: match.matchSource,
          error: match.error,
          matchedAccount: match.match
            ? {
                id: match.match.id,
                title: match.match.title,
                type: match.match.type,
                balance: match.match.balanceKopiykas?.toString() ?? null,
                hasBalance: match.match.balanceKopiykas != null,
              }
            : null,
        },
      };
    });

    return NextResponse.json({
      ok: true,
      summary: {
        altegioAccountsCount: altegioAccounts.length,
        bankAccountsCount: items.length,
        matchedCount: items.filter((item) => item.diagnostics.matchedAccount).length,
        missingBalanceCount: items.filter(
          (item) =>
            item.diagnostics.matchedAccount &&
            item.diagnostics.matchedAccount.hasBalance === false,
        ).length,
        errorsCount: items.filter((item) => item.diagnostics.error).length,
      },
      altegioAccounts: altegioAccounts.map((account) => ({
        id: account.id,
        title: account.title,
        type: account.type,
        balance: account.balanceKopiykas?.toString() ?? null,
        hasBalance: account.balanceKopiykas != null,
      })),
      bankAccounts: items,
    });
  } catch (error) {
    console.error("[admin/altegio/bank-accounts-test] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
