// Перезапис комірок «К-сть запитів» і «Загальний чек» у копії таблиці агенції.
// Рядок — дата в колонці A (Europe/Kyiv). Комірку ставимо числом із бази, без +1.

import { prisma } from '@/lib/prisma';
import { clientCountsTowardNewLeadsKpi, getKyivDayUtcBounds } from '@/lib/direct-stats-config';
import {
  columnIndexToA1,
  getSheetTitleById,
  googleSheetsConfigured,
  readSheetGrid,
  writeSheetCells,
} from '@/lib/google-sheets';

const SPREADSHEET_ID = '1EjOS1thRZuw0OgUUIT9qDYwq2MezvcleGQ3FJkeXaPU';
const SHEET_GID = 1471424792;

const LEADS_HEADER = 'к-сть запитів';
const CHECK_HEADER = 'загальний чек';

export type AgencySheetSyncResult = {
  ok: boolean;
  skipped?: boolean;
  kyivDay: string;
  leads?: number;
  checkUah?: number;
  error?: string;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Дата з комірки колонки A: 28.09.2026, 2026-09-28 або серійний номер Google. */
export function sheetCellToKyivDay(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    const y = utc.getUTCFullYear();
    const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utc.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return null;
}

async function countStarredLeads(kyivDay: string): Promise<number> {
  const { startUtc, endUtc } = getKyivDayUtcBounds(kyivDay);
  const rows = await prisma.directClient.findMany({
    where: {
      leadAgency: 'agency_1',
      firstContactDate: { gte: startUtc, lt: endUtc },
    },
    select: {
      includeInNewLeadsKpi: true,
      state: true,
      instagramUsername: true,
    },
  });
  return rows.filter((row) => clientCountsTowardNewLeadsKpi(row)).length;
}

async function sumStarredChecks(kyivDay: string): Promise<number> {
  const agg = await prisma.directClient.aggregate({
    where: {
      leadAgency: 'agency_1',
      starredLeadCheckKyivDay: kyivDay,
    },
    _sum: { starredLeadCheckUah: true },
  });
  return agg._sum.starredLeadCheckUah ?? 0;
}

export async function syncAgencySheetDay(kyivDay: string): Promise<AgencySheetSyncResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(kyivDay)) {
    return { ok: false, kyivDay, error: 'некоректний день' };
  }
  if (!googleSheetsConfigured()) {
    console.warn('[agency-sheet] Пропуск: немає GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON');
    return { ok: false, skipped: true, kyivDay, error: 'немає ключа Google' };
  }

  try {
    const [leads, checkUah] = await Promise.all([
      countStarredLeads(kyivDay),
      sumStarredChecks(kyivDay),
    ]);
    const title = await getSheetTitleById(SPREADSHEET_ID, SHEET_GID);
    const grid = await readSheetGrid(SPREADSHEET_ID, title, 'A1:ZZ40');

    let headerRow = -1;
    let leadsCol = -1;
    let checkCol = -1;
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const name = normalizeHeader(row[c]);
        if (name === LEADS_HEADER) leadsCol = c;
        if (name === CHECK_HEADER) checkCol = c;
      }
      if (leadsCol >= 0 && checkCol >= 0) {
        headerRow = r;
        break;
      }
      leadsCol = -1;
      checkCol = -1;
    }
    if (headerRow < 0 || leadsCol < 0 || checkCol < 0) {
      throw new Error('Не знайдено заголовки «К-сть запитів» і «Загальний чек»');
    }

    const dateRows = await readSheetGrid(SPREADSHEET_ID, title, 'A:A');
    let dataRow = -1;
    for (let r = headerRow + 1; r < dateRows.length; r++) {
      if (sheetCellToKyivDay(dateRows[r]?.[0]) === kyivDay) {
        dataRow = r;
        break;
      }
    }
    if (dataRow < 0) {
      console.warn('[agency-sheet] Немає рядка з датою', kyivDay);
      return { ok: false, kyivDay, leads, checkUah, error: 'немає рядка дати' };
    }

    const rowNumber = dataRow + 1;
    await writeSheetCells(SPREADSHEET_ID, title, [
      { a1: `${columnIndexToA1(leadsCol)}${rowNumber}`, value: leads },
      { a1: `${columnIndexToA1(checkCol)}${rowNumber}`, value: checkUah },
    ]);
    console.log('[agency-sheet] Записано', { kyivDay, leads, checkUah, row: rowNumber });
    return { ok: true, kyivDay, leads, checkUah };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[agency-sheet] Помилка запису', { kyivDay, error });
    return { ok: false, kyivDay, error };
  }
}
