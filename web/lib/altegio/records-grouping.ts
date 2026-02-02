// web/lib/altegio/records-grouping.ts
// Утиліти для групування record events з Altegio (в т.ч. "в 4 руки") по дню (Europe/Kyiv)
// та агрегації attendance / послуг.
//
// Ключові правила:
// - Групуємо по дню в Europe/Kyiv + типу групи (consultation|paid).
// - Консультацію НЕ змішуємо з платними послугами (якщо в одному raw event змішані послуги — розділяємо на 2 записи).
// - Attendance агрегуємо з пріоритетом:
//   1) ✅ arrived (якщо є хоч один attendance=1)
//   2) ❌ no-show (attendance=-1 і receivedAt в день/після дня візиту)
//   3) 🚫 cancelled (attendance=-1 і receivedAt ДО дня візиту)  -> attendance = -2 для UI
//   4) ⏳ pending (attendance=0 або невідомо)

export type GroupType = 'consultation' | 'paid';
export type AttendanceStatus = 'arrived' | 'no-show' | 'cancelled' | 'pending';

export type NormalizedRecordEvent = {
  clientId: number;
  datetime: string | null; // дата візиту/запису (ISO)
  receivedAt: string | null; // коли отримали вебхук (ISO)
  services: any[];
  staffId: number | null;
  staffName: string | null;
  attendance: number | null; // 1 | 0 | -1 | null
  status?: string | null;
  visitId?: number | null;
  recordId?: number | null;
  raw?: any;
};

export type RecordGroup = {
  clientId: number;
  kyivDay: string; // YYYY-MM-DD (Europe/Kyiv)
  groupType: GroupType;
  datetime: string | null; // max datetime у групі
  receivedAt: string | null; // max receivedAt у групі
  services: any[];
  staffIds: number[];
  staffNames: string[];
  attendanceStatus: AttendanceStatus;
  // агрегований attendance для сумісності (1 / -1 / 0 / -2 / null)
  attendance: number | null;
  events: NormalizedRecordEvent[];
};

const KYIV_TZ = 'Europe/Kyiv';

export function kyivDayFromISO(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // en-CA дає YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function isAdminStaffName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes('адм') || n.includes('адміністратор') || n.includes('administrator') || n.includes('admin');
}

export function isUnknownStaffName(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.toLowerCase();
  return n.includes('невідом');
}

export type ServiceMasterHistoryItem = {
  kyivDay: string; // YYYY-MM-DD
  masterName: string;
  source: string; // 'records-group' | 'manual' | ...
  recordedAt: string; // ISO
};

// Рахуємо суму послуг для запису (грн) на основі services з вебхуків Altegio.
// Бізнес-правило: використовуємо `cost * amount` і підсумовуємо по всіх послугах.
export function computeServicesTotalCostUAH(services: any[]): number {
  if (!Array.isArray(services) || services.length === 0) return 0;
  let total = 0;
  for (const s of services) {
    const costRaw = (s as any)?.cost;
    const amountRaw = (s as any)?.amount;
    const cost = typeof costRaw === 'number' ? costRaw : Number(costRaw);
    const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);
    if (!isFinite(cost) || !isFinite(amount)) continue;
    total += cost * amount;
  }
  // Сума у грн. На випадок дробів — округляємо до цілих грн.
  return Math.round(total);
}

export function pickNonAdminStaffFromGroup(
  group: RecordGroup,
  mode: 'latest' | 'first' = 'latest'
): { staffId: number | null; staffName: string } | null {
  const kyivDay = group.kyivDay;
  const events = Array.isArray(group.events) ? group.events : [];
  const relevant = events
    .filter((e) => {
      const name = (e.staffName || '').toString().trim();
      if (!name) return false;
      if (isUnknownStaffName(name)) return false;
      if (isAdminStaffName(name)) return false;
      // ВАЖЛИВО: для майбутніх записів webhooks часто приходять ЗАЗДАЛЕГІДЬ.
      // Тому staff потрібно прив'язувати до ДНЯ ВІЗИТУ (datetime), а не до дня отримання (receivedAt).
      const dayByDatetime = e.datetime ? kyivDayFromISO(e.datetime) : '';
      const dayByReceivedAt = e.receivedAt ? kyivDayFromISO(e.receivedAt) : '';
      if (!dayByDatetime && !dayByReceivedAt) return false;
      return dayByDatetime === kyivDay || dayByReceivedAt === kyivDay;
    })
    .sort((a, b) => {
      const ta = new Date(a.receivedAt || a.datetime || 0).getTime();
      const tb = new Date(b.receivedAt || b.datetime || 0).getTime();
      return mode === 'first' ? ta - tb : tb - ta;
    });

  const chosen = relevant[0];
  if (!chosen?.staffName) return null;
  return { staffId: chosen.staffId ?? null, staffName: String(chosen.staffName) };
}

export function pickNonAdminStaffPairFromGroup(
  group: RecordGroup,
  mode: 'latest' | 'first' = 'latest'
): Array<{ staffId: number | null; staffName: string }> {
  const kyivDay = group.kyivDay;
  const events = Array.isArray(group.events) ? group.events : [];

  const relevant = events
    .filter((e) => {
      const name = (e.staffName || '').toString().trim();
      if (!name) return false;
      if (isUnknownStaffName(name)) return false;
      if (isAdminStaffName(name)) return false;
      // staff прив’язуємо до ДНЯ ВІЗИТУ (datetime) або day receivedAt, якщо datetime відсутній
      const dayByDatetime = e.datetime ? kyivDayFromISO(e.datetime) : '';
      const dayByReceivedAt = e.receivedAt ? kyivDayFromISO(e.receivedAt) : '';
      if (!dayByDatetime && !dayByReceivedAt) return false;
      return dayByDatetime === kyivDay || dayByReceivedAt === kyivDay;
    })
    .sort((a, b) => {
      const ta = new Date(a.receivedAt || a.datetime || 0).getTime();
      const tb = new Date(b.receivedAt || b.datetime || 0).getTime();
      return mode === 'first' ? ta - tb : tb - ta;
    });

  const out: Array<{ staffId: number | null; staffName: string }> = [];
  const seen = new Set<string>();
  for (const e of relevant) {
    const staffName = (e.staffName || '').toString().trim();
    if (!staffName) continue;
    const staffId = e.staffId ?? null;
    const key = staffId != null ? `id:${staffId}` : `name:${staffName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ staffId, staffName });
    if (out.length >= 2) break;
  }

  return out;
}

/** Кількість унікальних non-admin staff у групі (для "рук": 1→2, 2→4, 3+→6). */
export function countNonAdminStaffInGroup(group: RecordGroup): number {
  const kyivDay = group.kyivDay;
  const events = Array.isArray(group.events) ? group.events : [];
  const relevant = events
    .filter((e) => {
      const name = (e.staffName || '').toString().trim();
      if (!name) return false;
      if (isUnknownStaffName(name)) return false;
      if (isAdminStaffName(name)) return false;
      const dayByDatetime = e.datetime ? kyivDayFromISO(e.datetime) : '';
      const dayByReceivedAt = e.receivedAt ? kyivDayFromISO(e.receivedAt) : '';
      if (!dayByDatetime && !dayByReceivedAt) return false;
      return dayByDatetime === kyivDay || dayByReceivedAt === kyivDay;
    });
  const seen = new Set<string>();
  for (const e of relevant) {
    const staffName = (e.staffName || '').toString().trim();
    if (!staffName) continue;
    const staffId = e.staffId ?? null;
    const key = staffId != null ? `id:${staffId}` : `name:${staffName.toLowerCase()}`;
    seen.add(key);
  }
  return seen.size;
}

/**
 * Визначає «головний» visitId для групи: один візит на день, щоб суми в колонці «Майстер»
 * відповідали саме цьому візиту, а не сумі всіх візитів за день.
 * Пріоритет: visitId з arrived-подій; інакше найчастіший visitId у групі.
 */
export function getMainVisitIdFromGroup(group: RecordGroup): number | null {
  const events = Array.isArray(group.events) ? group.events : [];
  const withVisitId = events.filter((e): e is NormalizedRecordEvent & { visitId: number } =>
    typeof e.visitId === 'number'
  );
  if (withVisitId.length === 0) return null;
  const arrived = withVisitId.filter((e) => e.attendance === 1);
  const source = arrived.length > 0 ? arrived : withVisitId;
  const countByVisitId = new Map<number, number>();
  for (const e of source) {
    countByVisitId.set(e.visitId, (countByVisitId.get(e.visitId) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [vid, count] of countByVisitId) {
    if (count > bestCount) {
      bestCount = count;
      best = vid;
    }
  }
  return best;
}

/**
 * Визначає visitId/recordId для breakdown так, щоб сума відповідала paidServiceTotalCost з БД.
 * Якщо targetSum задано — вибираємо візит/запис, сума подій якого найближча до targetSum (допуск ~10%).
 * Інакше — getMainVisitId / getMainRecordId.
 */
export function getVisitIdAndRecordIdForBreakdown(
  group: RecordGroup,
  targetSum?: number | null
): { visitId: number | null; recordId: number | null } {
  const events = Array.isArray(group.events) ? group.events : [];
  const tolerance = targetSum != null && targetSum > 0 ? Math.max(500, Math.round(targetSum * 0.1)) : 0;

  if (targetSum != null && targetSum > 0 && tolerance > 0) {
    const withVisitId = events.filter((e): e is NormalizedRecordEvent & { visitId: number } => typeof e.visitId === 'number');
    if (withVisitId.length > 0) {
      const sumByVisitId = new Map<number, number>();
      for (const e of withVisitId) {
        const v = e.visitId;
        const s = computeServicesTotalCostUAH(e.services || []);
        sumByVisitId.set(v, (sumByVisitId.get(v) ?? 0) + s);
      }
      let bestVisitId: number | null = null;
      let bestDiff = Infinity;
      for (const [vid, sum] of sumByVisitId) {
        const diff = Math.abs(sum - targetSum);
        if (diff <= tolerance && diff < bestDiff) {
          bestDiff = diff;
          bestVisitId = vid;
        }
      }
      if (bestVisitId != null) return { visitId: bestVisitId, recordId: null };
    }
    const withRecordId = events.filter((e): e is NormalizedRecordEvent & { recordId: number } => typeof e.recordId === 'number');
    if (withRecordId.length > 0) {
      const sumByRecordId = new Map<number, number>();
      for (const e of withRecordId) {
        const r = e.recordId;
        const s = computeServicesTotalCostUAH(e.services || []);
        sumByRecordId.set(r, (sumByRecordId.get(r) ?? 0) + s);
      }
      let bestRecordId: number | null = null;
      let bestDiff = Infinity;
      for (const [rid, sum] of sumByRecordId) {
        const diff = Math.abs(sum - targetSum);
        if (diff <= tolerance && diff < bestDiff) {
          bestDiff = diff;
          bestRecordId = rid;
        }
      }
      if (bestRecordId != null) return { visitId: null, recordId: bestRecordId };
    }
  }

  const mainVisitId = getMainVisitIdFromGroup(group);
  const mainRecordId = mainVisitId == null ? getMainRecordIdFromGroup(group) : null;
  return { visitId: mainVisitId, recordId: mainRecordId };
}

/**
 * Визначає «головний» recordId для групи, коли visitId відсутній (напр. старі записи з webhook log).
 * Один запис = один візит. Пріоритет: recordId з arrived; інакше найчастіший recordId.
 */
export function getMainRecordIdFromGroup(group: RecordGroup): number | null {
  const events = Array.isArray(group.events) ? group.events : [];
  const withRecordId = events.filter((e): e is NormalizedRecordEvent & { recordId: number } =>
    typeof e.recordId === 'number'
  );
  if (withRecordId.length === 0) return null;
  const arrived = withRecordId.filter((e) => e.attendance === 1);
  const source = arrived.length > 0 ? arrived : withRecordId;
  const countByRecordId = new Map<number, number>();
  for (const e of source) {
    countByRecordId.set(e.recordId, (countByRecordId.get(e.recordId) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [rid, count] of countByRecordId) {
    if (count > bestCount) {
      bestCount = count;
      best = rid;
    }
  }
  return best;
}

/**
 * Розбиття сум по майстрах у групі (для колонки «Майстер» з сумами в дужках).
 * Для кожного non-admin майстра повертає суму його послуг (cost*amount).
 * Якщо передано visitId — рахуємо тільки події цього візиту; інакше якщо recordId — тільки події цього запису.
 */
export function getPerMasterSumsFromGroup(
  group: RecordGroup,
  visitId?: number | null,
  recordId?: number | null
): { masterName: string; sumUAH: number }[] {
  const kyivDay = group.kyivDay;
  let events = Array.isArray(group.events) ? group.events : [];
  if (visitId != null) {
    events = events.filter((e) => e.visitId === visitId);
  } else if (recordId != null) {
    events = events.filter((e) => e.recordId === recordId);
  }
  const relevant = events.filter((e) => {
    const name = (e.staffName || '').toString().trim();
    if (!name) return false;
    if (isUnknownStaffName(name)) return false;
    if (isAdminStaffName(name)) return false;
    const dayByDatetime = e.datetime ? kyivDayFromISO(e.datetime) : '';
    const dayByReceivedAt = e.receivedAt ? kyivDayFromISO(e.receivedAt) : '';
    if (!dayByDatetime && !dayByReceivedAt) return false;
    return dayByDatetime === kyivDay || dayByReceivedAt === kyivDay;
  });
  const byKey = new Map<string, { masterName: string; sumUAH: number }>();
  for (const e of relevant) {
    const staffName = (e.staffName || '').toString().trim();
    if (!staffName) continue;
    const staffId = e.staffId ?? null;
    const key = staffId != null ? `id:${staffId}` : `name:${staffName.toLowerCase()}`;
    const sumUAH = computeServicesTotalCostUAH(e.services || []);
    const existing = byKey.get(key);
    if (existing) {
      existing.sumUAH += sumUAH;
    } else {
      byKey.set(key, { masterName: staffName, sumUAH });
    }
  }
  return Array.from(byKey.values()).filter((x) => x.sumUAH > 0);
}

/** Категорії для "Волосся" (ключові слова в назві/категорії з Altegio). */
const HAIR_CATEGORY_KEYWORDS = ['накладки', 'накладні хвости', 'треси', 'хвости'];

/**
 * Класифікує один сервіс/товар: послуга, волосся (Накладки, Накладні хвости, треси) або товар.
 * Використовує category з Altegio API або ключові слова в назві.
 */
export function classifyService(service: any): 'services' | 'hair' | 'goods' {
  if (!service || typeof service !== 'object') return 'services';
  const title = ((service.title ?? service.name ?? '').toString() || '').toLowerCase().trim();
  const categoryTitle = ((service.category?.title ?? service.category?.name ?? '').toString() || '').toLowerCase().trim();
  const combined = `${title} ${categoryTitle}`;
  for (const kw of HAIR_CATEGORY_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) return 'hair';
  }
  // Якщо в API є тип "товар" / "product" — можна перевірити service.type або category
  const type = (service.type ?? service.category?.type ?? '').toString().toLowerCase();
  if (type === 'product' || type === 'товар' || type === 'goods') return 'goods';
  return 'services';
}

/**
 * Розбиття сум по майстрах і категоріях (Послуги, Волосся, Товар) для групи.
 * Для статистики по майстрах.
 */
export function getPerMasterCategorySumsFromGroup(
  group: RecordGroup
): { masterName: string; servicesSum: number; hairSum: number; goodsSum: number }[] {
  const kyivDay = group.kyivDay;
  const events = Array.isArray(group.events) ? group.events : [];
  const relevant = events.filter((e) => {
    const name = (e.staffName || '').toString().trim();
    if (!name) return false;
    if (isUnknownStaffName(name)) return false;
    if (isAdminStaffName(name)) return false;
    const dayByDatetime = e.datetime ? kyivDayFromISO(e.datetime) : '';
    const dayByReceivedAt = e.receivedAt ? kyivDayFromISO(e.receivedAt) : '';
    if (!dayByDatetime && !dayByReceivedAt) return false;
    return dayByDatetime === kyivDay || dayByReceivedAt === kyivDay;
  });
  const byKey = new Map<string, { masterName: string; servicesSum: number; hairSum: number; goodsSum: number }>();
  for (const e of relevant) {
    const staffName = (e.staffName || '').toString().trim();
    if (!staffName) continue;
    const staffId = e.staffId ?? null;
    const key = staffId != null ? `id:${staffId}` : `name:${staffName.toLowerCase()}`;
    let row = byKey.get(key);
    if (!row) {
      row = { masterName: staffName, servicesSum: 0, hairSum: 0, goodsSum: 0 };
      byKey.set(key, row);
    }
    const services = Array.isArray(e.services) ? e.services : [];
    for (const s of services) {
      const costRaw = (s as any)?.cost;
      const amountRaw = (s as any)?.amount;
      const cost = typeof costRaw === 'number' ? costRaw : Number(costRaw);
      const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);
      if (!isFinite(cost) || !isFinite(amount)) continue;
      const sum = Math.round(cost * amount);
      const kind = classifyService(s);
      if (kind === 'hair') row.hairSum += sum;
      else if (kind === 'goods') row.goodsSum += sum;
      else row.servicesSum += sum;
    }
  }
  return Array.from(byKey.values());
}

export function pickStaffFromGroup(
  group: RecordGroup,
  opts?: { mode?: 'latest' | 'first'; allowAdmin?: boolean }
): { staffId: number | null; staffName: string } | null {
  const mode = opts?.mode || 'latest';
  const allowAdmin = opts?.allowAdmin ?? false;
  const kyivDay = group.kyivDay;
  const events = Array.isArray(group.events) ? group.events : [];

  const relevant = events
    .filter((e) => {
      const name = (e.staffName || '').toString().trim();
      if (!name) return false;
      if (isUnknownStaffName(name)) return false;
      if (!allowAdmin && isAdminStaffName(name)) return false;
      const dayByDatetime = e.datetime ? kyivDayFromISO(e.datetime) : '';
      const dayByReceivedAt = e.receivedAt ? kyivDayFromISO(e.receivedAt) : '';
      if (!dayByDatetime && !dayByReceivedAt) return false;
      return dayByDatetime === kyivDay || dayByReceivedAt === kyivDay;
    })
    .sort((a, b) => {
      const ta = new Date(a.receivedAt || a.datetime || 0).getTime();
      const tb = new Date(b.receivedAt || b.datetime || 0).getTime();
      return mode === 'first' ? ta - tb : tb - ta;
    });

  const chosen = relevant[0];
  if (!chosen?.staffName) return null;
  return { staffId: chosen.staffId ?? null, staffName: String(chosen.staffName) };
}

export function appendServiceMasterHistory(
  historyJson: string | null | undefined,
  item: Omit<ServiceMasterHistoryItem, 'recordedAt'> & { recordedAt?: string }
): string {
  const next: ServiceMasterHistoryItem = {
    kyivDay: item.kyivDay,
    masterName: item.masterName,
    source: item.source,
    recordedAt: item.recordedAt || new Date().toISOString(),
  };

  let arr: ServiceMasterHistoryItem[] = [];
  try {
    if (historyJson) {
      const parsed = JSON.parse(historyJson);
      if (Array.isArray(parsed)) arr = parsed as ServiceMasterHistoryItem[];
    }
  } catch {
    arr = [];
  }

  const last = arr.length ? arr[arr.length - 1] : null;
  if (last && last.masterName === next.masterName && last.kyivDay === next.kyivDay) {
    return JSON.stringify(arr);
  }

  // Не пишемо “зміну”, якщо майстер не змінився (навіть якщо день інший)
  if (last && last.masterName === next.masterName) {
    return JSON.stringify(arr);
  }

  arr.push(next);
  // страховка від розростання
  if (arr.length > 200) arr = arr.slice(arr.length - 200);
  return JSON.stringify(arr);
}

export function isConsultationServices(services: any[]): boolean {
  if (!Array.isArray(services)) return false;
  return services.some((s: any) => {
    const title = (s?.title || s?.name || '').toString();
    return /консультаці/i.test(title);
  });
}

function isConsultationServiceObj(s: any): boolean {
  const title = (s?.title || s?.name || '').toString();
  return /консультаці/i.test(title);
}

function groupTypeFromServices(services: any[]): GroupType {
  return isConsultationServices(services) ? 'consultation' : 'paid';
}

function parseKVItem(raw: any): any | null {
  try {
    let parsed: any = raw;
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
      try {
        parsed = JSON.parse(parsed.value);
      } catch {
        // ignore
      }
    }
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function extractClientId(e: any): number | null {
  const v =
    e?.clientId ??
    e?.data?.client?.id ??
    e?.data?.client_id ??
    e?.body?.data?.client?.id ??
    e?.body?.data?.client_id ??
    null;
  const n = v !== null && v !== undefined ? Number(v) : NaN;
  return !n || isNaN(n) ? null : n;
}

function extractDatetimeISO(e: any): string | null {
  const v = e?.datetime ?? e?.data?.datetime ?? e?.body?.data?.datetime ?? null;
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function extractReceivedAtISO(e: any, fallback: string | null): string | null {
  const v = e?.receivedAt ?? e?.body?.receivedAt ?? null;
  if (!v) return fallback;
  const d = new Date(v);
  if (isNaN(d.getTime())) return fallback;
  return d.toISOString();
}

function extractServices(e: any): any[] {
  const v =
    e?.services ??
    e?.data?.services ??
    e?.body?.data?.services ??
    (e?.data?.service ? [e.data.service] : null) ??
    (e?.body?.data?.service ? [e.body.data.service] : null) ??
    null;
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function extractAttendance(e: any): number | null {
  const v =
    e?.attendance ??
    e?.data?.attendance ??
    e?.visit_attendance ??
    e?.data?.visit_attendance ??
    e?.body?.data?.attendance ??
    e?.body?.data?.visit_attendance ??
    null;
  if (v === 1 || v === 0 || v === -1) return v;
  return null;
}

function extractStaff(e: any): { staffId: number | null; staffName: string | null } {
  const idRaw =
    e?.staffId ??
    e?.data?.staff?.id ??
    e?.data?.staff_id ??
    e?.body?.data?.staff?.id ??
    e?.body?.data?.staff_id ??
    null;
  const staffId = idRaw !== null && idRaw !== undefined ? Number(idRaw) : NaN;
  const staffName =
    e?.staffName ??
    e?.data?.staff?.name ??
    e?.data?.staff?.display_name ??
    e?.body?.data?.staff?.name ??
    e?.body?.data?.staff?.display_name ??
    null;

  return {
    staffId: !staffId || isNaN(staffId) ? null : staffId,
    staffName: staffName ? String(staffName) : null,
  };
}

function uniqStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = (v || '').trim();
    if (!t) continue;
    if (t.toLowerCase() === 'невідомий майстер') continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function uniqServices(services: any[]): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const s of services) {
    const title = (s?.title || s?.name || '').toString();
    const id = (s?.id ?? '').toString();
    const key = `${id}:${title}`.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function computeAttendanceForGroup(events: NormalizedRecordEvent[], kyivDay: string): { status: AttendanceStatus; attendance: number | null } {
  const hasArrived = events.some((e) => e.attendance === 1);
  if (hasArrived) return { status: 'arrived', attendance: 1 };

  const minusOnOrAfter: NormalizedRecordEvent[] = [];
  const minusBefore: NormalizedRecordEvent[] = [];

  for (const e of events) {
    if (e.attendance !== -1) continue;
    const receivedAt = e.receivedAt || e.datetime;
    if (!receivedAt) continue;
    const dayReceived = kyivDayFromISO(receivedAt);
    if (!dayReceived) continue;
    if (dayReceived < kyivDay) minusBefore.push(e);
    else minusOnOrAfter.push(e);
  }

  if (minusOnOrAfter.length > 0) return { status: 'no-show', attendance: -1 };
  if (minusBefore.length > 0) return { status: 'cancelled', attendance: -2 }; // 🚫 важливо для UI

  const hasPending = events.some((e) => e.attendance === 0);
  if (hasPending) return { status: 'pending', attendance: 0 };

  return { status: 'pending', attendance: null };
}

export function normalizeRecordsLogItems(rawItems: any[]): NormalizedRecordEvent[] {
  const out: NormalizedRecordEvent[] = [];

  for (const raw of rawItems || []) {
    const e = parseKVItem(raw);
    if (!e) continue;

    const clientId = extractClientId(e);
    if (!clientId) continue;

    const datetime = extractDatetimeISO(e);
    const receivedAt = extractReceivedAtISO(e, datetime);
    const services = extractServices(e);
    const attendance = extractAttendance(e);
    const { staffId, staffName } = extractStaff(e);

    // Розділяємо консультацію і платні послуги, якщо в одному event змішані послуги
    const consultationServices = services.filter(isConsultationServiceObj);
    const paidServices = services.filter((s) => !isConsultationServiceObj(s));

    const base: Omit<NormalizedRecordEvent, 'services'> = {
      clientId,
      datetime,
      receivedAt,
      staffId,
      staffName,
      attendance,
      status: e?.status ?? e?.body?.status ?? null,
      // visit_id з body.data (webhook log); record_id не підставляти як visitId
      visitId: e?.visitId ?? e?.body?.data?.visit_id ?? e?.body?.resource_id ?? null,
      recordId: e?.recordId ?? e?.body?.resource_id ?? null,
      raw: e,
    };

    if (consultationServices.length > 0) out.push({ ...base, services: consultationServices });
    if (paidServices.length > 0) out.push({ ...base, services: paidServices });
    if (consultationServices.length === 0 && paidServices.length === 0) out.push({ ...base, services: [] });
  }

  return out;
}

export function groupRecordsByClientDay(events: NormalizedRecordEvent[]): Map<number, RecordGroup[]> {
  const byClient = new Map<number, Map<string, RecordGroup>>();

  for (const e of events) {
    const baseIso = e.datetime || e.receivedAt;
    if (!baseIso) continue;
    const day = kyivDayFromISO(baseIso);
    if (!day) continue;

    const groupType = groupTypeFromServices(e.services);
    const key = `${day}|${groupType}`;

    if (!byClient.has(e.clientId)) byClient.set(e.clientId, new Map());
    const m = byClient.get(e.clientId)!;
    const existing = m.get(key);

    if (!existing) {
      m.set(key, {
        clientId: e.clientId,
        kyivDay: day,
        groupType,
        datetime: e.datetime,
        receivedAt: e.receivedAt,
        services: [...(e.services || [])],
        staffIds: e.staffId ? [e.staffId] : [],
        staffNames: e.staffName ? [e.staffName] : [],
        attendanceStatus: 'pending',
        attendance: null,
        events: [e],
      });
    } else {
      existing.events.push(e);
      existing.services.push(...(e.services || []));
      if (e.staffId) existing.staffIds.push(e.staffId);
      if (e.staffName) existing.staffNames.push(e.staffName);

      // max datetime/receivedAt
      if (e.datetime && (!existing.datetime || new Date(e.datetime) > new Date(existing.datetime))) {
        existing.datetime = e.datetime;
      }
      if (e.receivedAt && (!existing.receivedAt || new Date(e.receivedAt) > new Date(existing.receivedAt))) {
        existing.receivedAt = e.receivedAt;
      }
    }
  }

  const result = new Map<number, RecordGroup[]>();

  for (const [clientId, groupsMap] of byClient.entries()) {
    const groups = Array.from(groupsMap.values()).map((g) => {
      g.services = uniqServices(g.services);
      g.staffNames = uniqStrings(g.staffNames);
      g.staffIds = Array.from(new Set(g.staffIds.filter(Boolean)));

      const att = computeAttendanceForGroup(g.events, g.kyivDay);
      g.attendanceStatus = att.status;
      g.attendance = att.attendance;

      // Найновіші події першими (для зручності вибору майстра)
      g.events.sort((a, b) => {
        const ta = new Date(a.receivedAt || a.datetime || 0).getTime();
        const tb = new Date(b.receivedAt || b.datetime || 0).getTime();
        return tb - ta;
      });

      return g;
    });

    // Найновіші групи першими
    groups.sort((a, b) => {
      const ta = new Date(a.datetime || a.receivedAt || 0).getTime();
      const tb = new Date(b.datetime || b.receivedAt || 0).getTime();
      return tb - ta;
    });

    result.set(clientId, groups);
  }

  return result;
}

