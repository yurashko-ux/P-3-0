// Z-звіт: витяг доходів з блоку z_data (клієнти, послуги, товари) для звірки вхідних.
import { altegioFetch } from "./client";
import { parseMoneyString } from "./staff-period-income";
import { eachDateInclusiveYMD, extractZClientName, getZLineTitle } from "./z-report-turnover";

export type ZReportIncomeLine = {
  altegioId: number;
  documentId: number | null;
  accountTitle: string;
  accountId: string | null;
  payerName: string;
  amountKop: bigint;
  paymentPurpose: string | null;
  kyivDay: string;
  operationTime: string;
  visitId: number | null;
  clientId: number | null;
};

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function cleanText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text || null;
}

function toInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function syntheticZIncomeId(parts: {
  kyivDay: string;
  visitId: number | null;
  clientId: number | null;
  amountKop: bigint;
  title: string;
  lineIndex: number;
}): number {
  let hash = 910_000_000;
  const seed = `${parts.kyivDay}|${parts.visitId}|${parts.clientId}|${parts.amountKop}|${parts.title}|${parts.lineIndex}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  return 910_000_000 + (hash % 89_000_000);
}

function lineAmountKop(item: unknown): bigint {
  const record = asRecord(item);
  if (!record) return 0n;
  const amount =
    parseMoneyString(record.result_cost ?? record.resultCost ?? 0)
    || parseMoneyString(record.cost ?? record.Cost ?? 0)
    || parseMoneyString(record.paid_sum ?? record.paidSum ?? 0)
    || parseMoneyString(record.amount ?? record.sum ?? 0);
  if (amount <= 0) return 0n;
  return BigInt(Math.round(amount * 100));
}

function extractVisitId(clientRow: RawRecord): number | null {
  return toInt(clientRow.visit_id ?? clientRow.visitId ?? clientRow.record_id ?? clientRow.recordId);
}

function extractClientId(clientRow: RawRecord): number | null {
  const client = asRecord(clientRow.client) ?? asRecord(clientRow.client_data);
  return toInt(client?.id ?? clientRow.client_id ?? clientRow.clientId);
}

function extractAccountFromItem(item: RawRecord): { accountTitle: string; accountId: string | null } {
  const account = asRecord(item.account) ?? asRecord(item.cashbox) ?? asRecord(item.cash_box);
  const payType = cleanText(
    item.pay_type_title
      ?? item.payment_type_title
      ?? item.payment_method_title
      ?? asRecord(item.pay_type)?.title
      ?? asRecord(item.payment_type)?.title,
  );
  const accountTitle =
    cleanText(account?.title ?? account?.name ?? item.account_title ?? item.cashbox_title)
    || payType
    || "— з Z-звіту —";
  const accountId = toInt(item.account_id ?? item.cashbox_id ?? account?.id);
  return {
    accountTitle,
    accountId: accountId != null ? String(accountId) : null,
  };
}

function buildOperationTime(kyivDay: string, timeText: string | null): string {
  if (timeText && /^\d{2}:\d{2}/.test(timeText)) {
    return new Date(`${kyivDay}T${timeText.slice(0, 8).padEnd(8, "00")}.000+03:00`).toISOString();
  }
  return new Date(`${kyivDay}T12:00:00.000+03:00`).toISOString();
}

function addZLineItems(params: {
  items: unknown;
  fallbackTitle: string;
  clientRow: RawRecord;
  kyivDay: string;
  clientName: string;
  visitId: number | null;
  clientId: number | null;
  into: ZReportIncomeLine[];
  lineCounter: { value: number };
}): void {
  if (!Array.isArray(params.items)) return;
  const timeText = cleanText(params.clientRow.time ?? params.clientRow.visit_time ?? params.clientRow.datetime);

  for (const rawItem of params.items) {
    const item = asRecord(rawItem);
    if (!item) continue;
    const amountKop = lineAmountKop(item);
    if (amountKop <= 0n) continue;

    const title = getZLineTitle(item, params.fallbackTitle);
    const { accountTitle, accountId } = extractAccountFromItem(item);
    params.lineCounter.value += 1;

    params.into.push({
      altegioId: syntheticZIncomeId({
        kyivDay: params.kyivDay,
        visitId: params.visitId,
        clientId: params.clientId,
        amountKop,
        title,
        lineIndex: params.lineCounter.value,
      }),
      documentId: toInt(item.document_id ?? item.documentId ?? item.sale_id),
      accountTitle,
      accountId,
      payerName: params.clientName,
      amountKop,
      paymentPurpose: title,
      kyivDay: params.kyivDay,
      operationTime: buildOperationTime(params.kyivDay, timeText),
      visitId: params.visitId,
      clientId: params.clientId,
    });
  }
}

/** Розбирає z_data Z-звіту на рядки доходів з іменами платників. */
export function collectZDataIncomeLines(zData: unknown, kyivDay: string): ZReportIncomeLine[] {
  const lines: ZReportIncomeLine[] = [];
  if (!zData || typeof zData !== "object") return lines;

  const lineCounter = { value: 0 };

  for (const bucket of Object.values(zData as Record<string, unknown>)) {
    if (!Array.isArray(bucket)) continue;
    for (const rawClientRow of bucket) {
      const clientRow = asRecord(rawClientRow);
      if (!clientRow) continue;

      const client = extractZClientName(clientRow);
      const visitId = extractVisitId(clientRow);
      const clientId = extractClientId(clientRow);
      const masters = clientRow.masters;
      if (!Array.isArray(masters)) continue;

      for (const rawMaster of masters) {
        const master = asRecord(rawMaster);
        if (!master) continue;
        addZLineItems({
          items: master.service ?? master.services,
          fallbackTitle: "Послуга",
          clientRow,
          kyivDay,
          clientName: client.name,
          visitId,
          clientId,
          into: lines,
          lineCounter,
        });
        addZLineItems({
          items: master.good ?? master.goods,
          fallbackTitle: "Товар",
          clientRow,
          kyivDay,
          clientName: client.name,
          visitId,
          clientId,
          into: lines,
          lineCounter,
        });

        const others = asRecord(master.others);
        if (others) {
          addZLineItems({
            items: [others],
            fallbackTitle: "Інше",
            clientRow,
            kyivDay,
            clientName: client.name,
            visitId,
            clientId,
            into: lines,
            lineCounter,
          });
        }
      }
    }
  }

  return lines;
}

export async function fetchZReportIncomeLinesRange(params: {
  locationId: string;
  dateFrom: string;
  dateTo: string;
  delayMsBetweenDays?: number;
}): Promise<ZReportIncomeLine[]> {
  const locationNum = Number(params.locationId);
  if (!Number.isFinite(locationNum) || locationNum <= 0) return [];

  const days = eachDateInclusiveYMD(params.dateFrom, params.dateTo);
  const delay = params.delayMsBetweenDays ?? 60;
  const lines: ZReportIncomeLine[] = [];

  for (const day of days) {
    try {
      const qs = new URLSearchParams();
      qs.set("start_date", day);
      qs.set("end_date", day);
      const raw = await altegioFetch<unknown>(`reports/z_report/${locationNum}?${qs.toString()}`);
      const payload = asRecord(raw) ?? {};
      const data = asRecord(payload.data) ?? payload;
      const zData = data.z_data ?? data.zData;
      const dayLines = collectZDataIncomeLines(zData, day);
      lines.push(...dayLines);
      console.log("[altegio/z-report-income] День Z-звіту", {
        day,
        lines: dayLines.length,
      });
    } catch (error) {
      console.warn("[altegio/z-report-income] Не вдалося отримати Z-звіт за день", {
        day,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return lines;
}
