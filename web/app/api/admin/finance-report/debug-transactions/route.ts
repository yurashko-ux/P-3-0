// web/app/api/admin/finance-report/debug-transactions/route.ts
// Debug endpoint для перевірки всіх транзакцій, які витягуються з API
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
    throw new Error("ALTEGIO_COMPANY_ID is required");
  }
  return companyId;
}

/**
 * GET: Отримати всі транзакції з різних endpoint'ів для порівняння
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

    // Спробуємо різні endpoint'и
    const endpoints = [
      {
        name: "POST /company/{id}/finance_transactions/search",
        method: "POST" as const,
        path: `/company/${companyId}/finance_transactions/search`,
        body: {
          start_date: date_from,
          end_date: date_to,
          count: 10000,
          page: 1,
        },
      },
      {
        name: "GET /transactions/{location_id}",
        method: "GET" as const,
        path: `/transactions/${companyId}`,
        params: new URLSearchParams({
          start_date: date_from,
          end_date: date_to,
          count: "10000",
        }),
      },
      {
        name: "GET /finance_transactions/{location_id}",
        method: "GET" as const,
        path: `/finance_transactions/${companyId}`,
        params: new URLSearchParams({
          start_date: date_from,
          end_date: date_to,
          count: "10000",
        }),
      },
    ];

    const results: Array<{
      endpoint: string;
      success: boolean;
      transactionCount: number;
      categories: string[];
      sampleTransactions: any[];
      error?: string;
    }> = [];

    for (const endpoint of endpoints) {
      try {
        let raw: any;
        
        if (endpoint.method === "POST") {
          raw = await altegioFetch<any>(endpoint.path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(endpoint.body),
          });
        } else {
          const fullPath = `${endpoint.path}?${endpoint.params!.toString()}`;
          raw = await altegioFetch<any>(fullPath);
        }

        const tx: any[] = Array.isArray(raw)
          ? raw
          : raw && typeof raw === "object" && Array.isArray((raw as any).data)
            ? (raw as any).data
            : [];

        // Витягуємо всі унікальні категорії
        const categories = new Set<string>();
        tx.forEach((t: any) => {
          const category = t.expense?.title || 
                          t.expense?.name || 
                          t.comment || 
                          t.type || 
                          "Unknown";
          categories.add(category);
        });

        // Беремо перші 20 транзакцій для прикладу
        const sampleTransactions = tx.slice(0, 20).map((t: any) => ({
          id: t.id,
          date: t.date,
          amount: t.amount,
          expense_id: t.expense_id,
          expense_title: t.expense?.title,
          expense_name: t.expense?.name,
          comment: t.comment,
          type: t.type,
          type_id: t.type_id,
        }));

        results.push({
          endpoint: endpoint.name,
          success: true,
          transactionCount: tx.length,
          categories: Array.from(categories).sort(),
          sampleTransactions,
        });
      } catch (err: any) {
        results.push({
          endpoint: endpoint.name,
          success: false,
          transactionCount: 0,
          categories: [],
          sampleTransactions: [],
          error: err?.message || String(err),
        });
      }
    }

    // Знаходимо найуспішніший endpoint
    const successfulResults = results.filter(r => r.success);
    const bestResult = successfulResults.reduce((best, current) => 
      current.transactionCount > best.transactionCount ? current : best,
      successfulResults[0] || results[0]
    );

    // Об'єднуємо всі категорії з усіх endpoint'ів
    const allCategories = new Set<string>();
    successfulResults.forEach(r => {
      r.categories.forEach(cat => allCategories.add(cat));
    });

    return NextResponse.json({
      period: { year, month, date_from, date_to },
      companyId,
      endpoints: results,
      summary: {
        totalEndpoints: endpoints.length,
        successfulEndpoints: successfulResults.length,
        bestEndpoint: bestResult.endpoint,
        totalTransactions: bestResult.transactionCount,
        totalUniqueCategories: allCategories.size,
        allCategories: Array.from(allCategories).sort(),
      },
      bestResult: {
        endpoint: bestResult.endpoint,
        transactionCount: bestResult.transactionCount,
        categories: bestResult.categories,
        sampleTransactions: bestResult.sampleTransactions,
      },
    });
  } catch (error: any) {
    console.error("[admin/finance-report/debug-transactions] GET error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}
