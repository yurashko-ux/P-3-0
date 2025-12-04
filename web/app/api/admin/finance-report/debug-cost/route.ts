// web/app/api/admin/finance-report/debug-cost/route.ts
// Debug endpoint для перевірки обчислення собівартості з API
// Захищено CRON_SECRET

import { NextRequest, NextResponse } from "next/server";
import { altegioFetch } from "@/lib/altegio/client";
import { ALTEGIO_ENV } from "@/lib/altegio/env";

export const dynamic = "force-dynamic";

/**
 * Перевіряє, чи запит дозволений (тільки з CRON_SECRET)
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const envSecret = process.env.CRON_SECRET || "";
  return envSecret && secret && envSecret === secret;
}

function resolveCompanyId(): string {
  const fromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const fallback = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;

  const companyId = fromEnv || fallback;
  if (!companyId) {
    throw new Error(
      "ALTEGIO_COMPANY_ID is required",
    );
  }
  return companyId;
}

/**
 * GET: Отримати детальну інформацію про транзакції та обчислення собівартості
 * 
 * Query params:
 * - secret: CRON_SECRET (обов'язково)
 * - year: рік (за замовчуванням поточний)
 * - month: місяць (за замовчуванням поточний)
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const yearParam = req.nextUrl.searchParams.get("year");
    const monthParam = req.nextUrl.searchParams.get("month");
    
    const now = new Date();
    const year = yearParam ? parseInt(yearParam, 10) : now.getFullYear();
    const month = monthParam ? parseInt(monthParam, 10) : now.getMonth() + 1;
    
    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Invalid year or month" },
        { status: 400 },
      );
    }

    const date_from = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const date_to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const companyId = resolveCompanyId();

    // Отримуємо транзакції з storages
    const qs = new URLSearchParams({
      start_date: date_from,
      end_date: date_to,
    });
    const path = `/storages/transactions/${companyId}?${qs.toString()}`;
    const raw = await altegioFetch<any>(path);

    const tx: any[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as any).data)
        ? (raw as any).data
        : [];

    const sales = tx.filter((t) => Number(t.type_id) === 1);
    const purchases = tx.filter((t) => Number(t.type_id) === 2);

    // Детальна інформація про транзакції
    const salesDetails = sales.slice(0, 5).map((t) => ({
      id: t.id,
      type_id: t.type_id,
      amount: t.amount,
      cost: t.cost,
      cost_per_unit: t.cost_per_unit,
      create_date: t.create_date,
      good_id: t.good_id,
      good: t.good,
      allKeys: Object.keys(t),
    }));

    const purchasesDetails = purchases.slice(0, 5).map((t) => ({
      id: t.id,
      type_id: t.type_id,
      amount: t.amount,
      cost: t.cost,
      cost_per_unit: t.cost_per_unit,
      create_date: t.create_date,
      good_id: t.good_id,
      good: t.good,
      allKeys: Object.keys(t),
    }));

    // Обчислюємо собівартість з різних джерел
    let calculatedCostFromPurchases: number | null = null;
    if (purchases.length > 0) {
      const purchaseCost = purchases.reduce((sum, t) => {
        const costPerUnit = Number(t.cost_per_unit) || 0;
        const amount = Math.abs(Number(t.amount) || 0);
        if (costPerUnit > 0 && amount > 0) {
          return sum + (costPerUnit * amount);
        }
        const totalCost = Math.abs(Number(t.cost) || 0);
        if (totalCost > 0) {
          return sum + totalCost;
        }
        return sum;
      }, 0);
      
      if (purchaseCost > 0) {
        calculatedCostFromPurchases = purchaseCost;
      }
    }

    let calculatedCostFromSales: number | null = null;
    if (sales.length > 0) {
      const sampleSale = sales[0];
      const possibleCostFields = Object.keys(sampleSale).filter(key => 
        key.toLowerCase().includes('wholesale') || 
        key.toLowerCase().includes('purchase') ||
        key.toLowerCase().includes('buy') ||
        (key.toLowerCase().includes('cost') && !key.toLowerCase().includes('per'))
      );

      if (possibleCostFields.length > 0) {
        const costFromSales = sales.reduce((sum, t) => {
          for (const field of possibleCostFields) {
            const value = Number((t as any)[field]) || 0;
            if (value > 0) {
              return sum + Math.abs(value);
            }
          }
          return sum;
        }, 0);
        
        if (costFromSales > 0) {
          calculatedCostFromSales = costFromSales;
        }
      }

      if (calculatedCostFromSales === null) {
        const costFromCostPerUnit = sales.reduce((sum, t) => {
          const costPerUnit = Number(t.cost_per_unit) || 0;
          const amount = Math.abs(Number(t.amount) || 0);
          if (costPerUnit > 0 && amount > 0) {
            return sum + (costPerUnit * amount);
          }
          return sum;
        }, 0);
        
        if (costFromCostPerUnit > 0) {
          calculatedCostFromSales = costFromCostPerUnit;
        }
      }
    }

    // Спробуємо Payments API
    let calculatedCostFromPayments: number | null = null;
    try {
      const paymentsPath = `/transactions/${companyId}?start_date=${date_from}&end_date=${date_to}&real_money=1&deleted=0&count=1000`;
      const paymentsRaw = await altegioFetch<any>(paymentsPath);
      
      const paymentsTx: any[] = Array.isArray(paymentsRaw)
        ? paymentsRaw
        : paymentsRaw && typeof paymentsRaw === "object" && Array.isArray((paymentsRaw as any).data)
          ? (paymentsRaw as any).data
          : [];
      
      const purchasePayments = paymentsTx.filter((t: any) => {
        const expenseTitle = t.expense?.title || t.expense?.name || "";
        return expenseTitle.toLowerCase().includes("purchase") ||
               expenseTitle.toLowerCase().includes("product purchase") ||
               expenseTitle.toLowerCase().includes("закупка") ||
               t.type === "purchase";
      });
      
      if (purchasePayments.length > 0) {
        const costFromPayments = purchasePayments.reduce((sum: number, t: any) => {
          const amount = Math.abs(Number(t.amount) || 0);
          return sum + amount;
        }, 0);
        
        if (costFromPayments > 0) {
          calculatedCostFromPayments = costFromPayments;
        }
      }
    } catch (err: any) {
      console.warn(`[debug-cost] Failed to fetch from Payments API:`, err?.message);
    }

    // Обчислюємо виручку
    const revenue = sales.reduce(
      (sum, t) => {
        const transactionCost = Math.abs(Number(t.cost) || 0);
        if (transactionCost > 0) {
          return sum + transactionCost;
        } else {
          const amount = Math.abs(Number(t.amount) || 0);
          const costPerUnit = Number(t.cost_per_unit) || 0;
          return sum + amount * costPerUnit;
        }
      },
      0,
    );

    return NextResponse.json({
      period: { year, month, date_from, date_to },
      summary: {
        totalTransactions: tx.length,
        salesCount: sales.length,
        purchasesCount: purchases.length,
        revenue,
      },
      costCalculation: {
        fromPurchases: calculatedCostFromPurchases,
        fromSales: calculatedCostFromSales,
        fromPayments: calculatedCostFromPayments,
        final: calculatedCostFromPurchases || calculatedCostFromSales || calculatedCostFromPayments || null,
      },
      sampleSales: salesDetails,
      samplePurchases: purchasesDetails,
      fullSampleSale: sales.length > 0 ? sales[0] : null,
      fullSamplePurchase: purchases.length > 0 ? purchases[0] : null,
    });
  } catch (error: any) {
    console.error("[admin/finance-report/debug-cost] GET error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}
