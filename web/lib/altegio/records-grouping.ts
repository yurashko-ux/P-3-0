// web/lib/altegio/records-grouping.ts
// Утиліти для групування Altegio records/webhooks по "одному візиту" у 4 руки
// (групуємо по дню в Europe/Kyiv + типу: consultation|paid)
//
// Важливо:
// - В одному дні для одного клієнта вважаємо 1 візит (за домовленістю).
// - Консультацію НЕ змішуємо з платними послугами (окремі групи).
// - Attendance агрегуємо з пріоритетами:
//   1) ✅ Прийшов (якщо є хоч один attendance=1)
//   2) ❌ Не з'явився (attendance=-1 і receivedAt в день/після дати візиту)
//   3) 🚫 Скасовано (attendance=-1 і receivedAt ДО дати візиту)
//   4) ⏳ Очікується (attendance=0)

export type GroupType = 'consultation' | 'paid';

export type GroupAttendanceCode = 'attended' | 'no_show' | 'cancelled' | 'expected' | 'unknown';

export type GroupAttendance = {
  code: GroupAttendanceCode;
  // Для сумісності з існуючим UI:
  //  1  - прийшов
  //  0  - очікується
  // -1  - не з'явився
  // -2  - скасовано (новий статус)
  value: 1 | 0 | -1 | -2 | null;
  label: string;
  icon: string;
};

export type NormalizedRecordEvent = {
  source: 'records:log' | 'webhook:log';
  clientId: number;
  visitId?: number | null;
  status?: string | null; // create/update/...
  receivedAt: string; // ISO
  datetime: string | null; // ISO (дата візиту)
  attendance: number | null; // 1 | 0 | -1 | null
  staffId?: number | null;
  staffName?: string | null;
  services: Array<{ id?: number | null; title?: string | null; name?: string | null; cost?: number | null }>;
  raw: any;
};

// ---- Сумісність з існуючим кодом (update-states-from-records) ----
// Старий код очікує:
// - normalizeRecordsLogItems(rawItems) -> NormalizedRecordEvent[]
// - groupRecordsByClientDay(events) -> Map<clientId, Group[]>
// - isAdminStaffName(name) -> boolean

export function isAdminStaffName(name: string): boolean {
  const n = (name || '').toString().trim().toLowerCase();
  if (!n) return false;
  // Найчастіші варіанти з Altegio
  if (n.includes('адміністратор')) return true;
  if (n.includes('administrator')) return true;
  if (n.includes('admin')) return true;
  return false;
}

export function normalizeRecordsLogItems(rawItems: any[]): NormalizedRecordEvent[] {
  return (rawItems || [])
    .map((r) => normalizeRecordLikeEvent(r, 'records:log'))
    .filter((e): e is NonNullable<typeof e> => !!e);
}

export type ClientDayGroup = {
  groupType: GroupType;
  visitDayKyiv: string;
  datetime: string | null;
  receivedAt: string; // latest receivedAt in group
  staffNames: string[];
  staffIds: number[];
  services: any[]; // об'єкти сервісів (для determineStateFromServices)
  attendanceStatus: 'arrived' | 'no-show' | 'cancelled' | 'expected' | 'unknown';
  events: Array<{ staffName?: string | null; staffId?: number | null; attendance: number | null; receivedAt: string }>;
};

export function groupRecordsByClientDay(events: NormalizedRecordEvent[]): Map<number, ClientDayGroup[]> {
  const grouped = groupRecordsByKyivDay(events);
  const byClient = new Map<number, ClientDayGroup[]>();

  for (const g of grouped) {
    const status =
      g.attendance.code === 'attended'
        ? 'arrived'
        : g.attendance.code === 'no_show'
          ? 'no-show'
          : g.attendance.code === 'cancelled'
            ? 'cancelled'
            : g.attendance.code === 'expected'
              ? 'expected'
              : 'unknown';

    // Для determineStateFromServices потрібні обʼєкти services; беремо їх з подій, унікалізацію робить determineStateFromServices сам
    const servicesObjects = g.events.flatMap((e) => e.services || []);

    const entry: ClientDayGroup = {
      groupType: g.groupType,
      visitDayKyiv: g.visitDayKyiv,
      datetime: g.datetime,
      receivedAt: g.receivedAtLatest,
      staffNames: g.staffNames,
      staffIds: g.staffIds,
      services: servicesObjects,
      attendanceStatus: status,
      events: g.events.map((e) => ({
        staffName: e.staffName,
        staffId: e.staffId,
        attendance: e.attendance,
        receivedAt: e.receivedAt,
      })),
    };

    const list = byClient.get(g.clientId) || [];
    list.push(entry);
    byClient.set(g.clientId, list);
  }

  // Сортуємо групи для кожного клієнта (найновіші спочатку)
  for (const [clientId, list] of byClient.entries()) {
    list.sort((a, b) => {
      const ta = a.datetime ? new Date(a.datetime).getTime() : new Date(a.receivedAt).getTime();
      const tb = b.datetime ? new Date(b.datetime).getTime() : new Date(b.receivedAt).getTime();
      return tb - ta;
    });
    byClient.set(clientId, list);
  }

  return byClient;
}

function safeToISOString(value: any): string | null {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

export function kyivDayKey(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  // en-CA дає YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function isConsultationServices(services: any[]): boolean {
  if (!Array.isArray(services) || services.length === 0) return false;
  return services.some((s: any) => {
    const title = (s?.title || s?.name || '').toString().toLowerCase();
    return /консультаці/i.test(title);
  });
}

export function splitServicesByType(services: any[]): { consultation: any[]; paid: any[] } {
  const consultation: any[] = [];
  const paid: any[] = [];
  for (const s of Array.isArray(services) ? services : []) {
    const title = (s?.title || s?.name || '').toString();
    if (/консультаці/i.test(title)) consultation.push(s);
    else paid.push(s);
  }
  return { consultation, paid };
}

export function normalizeRecordLikeEvent(raw: any, source: 'records:log' | 'webhook:log'): NormalizedRecordEvent | null {
  try {
    // Розгортаємо Upstash wrapper { value: "..." }
    let parsed: any = raw;
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
      try {
        parsed = JSON.parse(parsed.value);
      } catch {
        // leave as-is
      }
    }

    // Приводимо webhook:log до record-подібного формату
    const body = parsed?.body && typeof parsed.body === 'object' ? parsed.body : null;
    const isWebhookRecord = body?.resource === 'record';

    // records:log формат: { visitId, clientId, datetime, status, receivedAt, data: { services, staff, client }, attendance }
    const data = isWebhookRecord ? (body?.data || {}) : (parsed?.data || {});

    const clientIdRaw =
      (isWebhookRecord ? (data?.client?.id || data?.client_id) : (parsed?.clientId || data?.client?.id || data?.client_id));
    const clientId = clientIdRaw ? Number(clientIdRaw) : NaN;
    if (!clientId || isNaN(clientId)) return null;

    // services
    let services: any[] = [];
    const dataServices = isWebhookRecord ? data?.services : data?.services;
    if (Array.isArray(dataServices)) services = dataServices;
    else if (typeof dataServices === 'string') {
      try {
        const parsedServices = JSON.parse(dataServices);
        if (Array.isArray(parsedServices)) services = parsedServices;
      } catch {
        services = [];
      }
    } else if (isWebhookRecord && data?.service && typeof data.service === 'object') {
      services = [data.service];
    }

    // staff
    const staffObj = (isWebhookRecord ? data?.staff : data?.staff) || parsed?.staff || null;
    const staffIdRaw = (isWebhookRecord ? (data?.staff?.id || data?.staff_id) : (parsed?.staffId || data?.staff?.id || data?.staff_id));
    const staffId = staffIdRaw ? Number(staffIdRaw) : null;
    const staffName =
      (isWebhookRecord
        ? (data?.staff?.name || data?.staff?.display_name || null)
        : (parsed?.staffName || staffObj?.name || staffObj?.display_name || null));

    // datetime: дата візиту
    const datetime = safeToISOString((isWebhookRecord ? data?.datetime : (parsed?.datetime || data?.datetime)));
    // receivedAt: коли прийшов webhook/record
    const receivedAt = safeToISOString(parsed?.receivedAt || (isWebhookRecord ? parsed?.receivedAt : null) || datetime) || new Date().toISOString();

    // attendance
    const attendanceRaw =
      (isWebhookRecord
        ? (data?.attendance ?? data?.visit_attendance)
        : (parsed?.attendance ?? parsed?.visit_attendance ?? data?.attendance ?? data?.visit_attendance));
    const attendance =
      attendanceRaw === 1 || attendanceRaw === 0 || attendanceRaw === -1
        ? attendanceRaw
        : (typeof attendanceRaw === 'string' ? (parseInt(attendanceRaw, 10) as any) : null);

    const visitIdRaw = isWebhookRecord ? body?.resource_id : parsed?.visitId;
    const visitId = visitIdRaw ? Number(visitIdRaw) : null;

    const status = isWebhookRecord ? body?.status : (parsed?.status || null);

    return {
      source,
      clientId,
      visitId,
      status,
      receivedAt,
      datetime,
      attendance: attendance === 1 || attendance === 0 || attendance === -1 ? attendance : null,
      staffId: staffId && !isNaN(staffId) ? staffId : null,
      staffName: staffName ? String(staffName) : null,
      services: Array.isArray(services) ? services : [],
      raw: parsed,
    };
  } catch {
    return null;
  }
}

export type GroupedRecord = {
  key: string;
  clientId: number;
  groupType: GroupType;
  visitDayKyiv: string; // YYYY-MM-DD
  datetime: string | null; // дата візиту (ISO)
  receivedAtLatest: string; // ISO
  attendance: GroupAttendance;
  staffNames: string[];
  staffIds: number[];
  services: string[]; // titles
  statuses: string[]; // create/update...
  events: NormalizedRecordEvent[];
};

function uniqStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = (v || '').toString().trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function uniqNumbers(values: Array<number | null | undefined>): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of values) {
    if (typeof v !== 'number' || isNaN(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function computeGroupAttendance(events: NormalizedRecordEvent[], visitDayKyiv: string): GroupAttendance {
  let hasAttended = false;
  let hasNoShow = false;
  let hasCancelled = false;
  let hasExpected = false;

  for (const e of events) {
    const att = e.attendance;
    if (att === 1) {
      hasAttended = true;
      continue;
    }
    if (att === 0) {
      hasExpected = true;
      continue;
    }
    if (att === -1) {
      // Визначаємо "скасовано" vs "не з'явився"
      try {
        const dayReceived = kyivDayKey(e.receivedAt);
        if (dayReceived < visitDayKyiv) hasCancelled = true;
        else hasNoShow = true;
      } catch {
        hasNoShow = true;
      }
    }
  }

  if (hasAttended) return { code: 'attended', value: 1, icon: '✅', label: 'Прийшов' };
  if (hasNoShow) return { code: 'no_show', value: -1, icon: '❌', label: "Не з'явився" };
  if (hasCancelled) return { code: 'cancelled', value: -2, icon: '🚫', label: 'Скасовано' };
  if (hasExpected) return { code: 'expected', value: 0, icon: '⏳', label: 'Очікується' };
  return { code: 'unknown', value: null, icon: '-', label: '-' };
}

export function groupRecordsByKyivDay(events: NormalizedRecordEvent[]): GroupedRecord[] {
  const groups = new Map<string, GroupedRecord>();

  for (const e of events) {
    const datetime = e.datetime || e.receivedAt;
    const visitDayKyiv = kyivDayKey(datetime);

    // Розділяємо консультацію і платні послуги
    const { consultation, paid } = splitServicesByType(e.services || []);
    const hasConsult = consultation.length > 0;
    const hasPaid = paid.length > 0;

    const pushToGroup = (groupType: GroupType, servicesForType: any[]) => {
      const key = `${e.clientId}:${groupType}:${visitDayKyiv}`;
      const existing = groups.get(key);
      const normalizedEvent: NormalizedRecordEvent = {
        ...e,
        services: servicesForType,
      };
      if (!existing) {
        groups.set(key, {
          key,
          clientId: e.clientId,
          groupType,
          visitDayKyiv,
          datetime: e.datetime,
          receivedAtLatest: e.receivedAt,
          attendance: { code: 'unknown', value: null, icon: '-', label: '-' },
          staffNames: [],
          staffIds: [],
          services: [],
          statuses: [],
          events: [normalizedEvent],
        });
      } else {
        existing.events.push(normalizedEvent);
        // Візитний datetime зазвичай однаковий; якщо різний - беремо найбільш пізній як більш точний
        const dtExisting = existing.datetime ? new Date(existing.datetime).getTime() : 0;
        const dtNew = e.datetime ? new Date(e.datetime).getTime() : 0;
        if (dtNew > dtExisting) existing.datetime = e.datetime;
        if (new Date(e.receivedAt).getTime() > new Date(existing.receivedAtLatest).getTime()) {
          existing.receivedAtLatest = e.receivedAt;
        }
      }
    };

    // Якщо є консультація — додаємо в consultation group
    if (hasConsult) pushToGroup('consultation', consultation);
    // Якщо є платні послуги — додаємо в paid group
    if (hasPaid) pushToGroup('paid', paid);
    // Якщо взагалі без services — класифікуємо як paid (щоб не втрачати подію)
    if (!hasConsult && !hasPaid) pushToGroup('paid', []);
  }

  const out = Array.from(groups.values());
  for (const g of out) {
    g.staffNames = uniqStrings(g.events.map((e) => e.staffName));
    g.staffIds = uniqNumbers(g.events.map((e) => e.staffId));
    g.services = uniqStrings(
      g.events.flatMap((e) => (e.services || []).map((s: any) => (s?.title || s?.name || '').toString()))
    ).filter((s) => s.toLowerCase() !== 'запис');
    g.statuses = uniqStrings(g.events.map((e) => e.status || null));
    g.attendance = computeGroupAttendance(g.events, g.visitDayKyiv);
  }

  // Сортуємо за датою візиту (datetime) або за днем
  out.sort((a, b) => {
    const ta = a.datetime ? new Date(a.datetime).getTime() : new Date(a.receivedAtLatest).getTime();
    const tb = b.datetime ? new Date(b.datetime).getTime() : new Date(b.receivedAtLatest).getTime();
    return tb - ta;
  });

  return out;
}

// web/lib/altegio/records-grouping.ts
// Утиліти для групування record events з Altegio (в т.ч. "в 4 руки") по дню (Europe/Kyiv)
// та агрегації attendance / послуг.

export type RecordGroupType = 'paid' | 'consultation';

export type AttendanceGroupStatus = 'attended' | 'no-show' | 'cancelled' | 'pending';

export type NormalizedRecordEvent = {
  clientId: number;
  receivedAt: string | null;
  datetime: string | null;
  services: Array<{ title?: string; name?: string; id?: number | string; cost?: number }>;
  staffId?: number | string | null;
  staffName?: string | null;
  attendance: number | null; // 1 | -1 | 0 | null
  source?: 'records:log' | 'webhook:log';
};

export type DailyRecordGroup = {
  clientId: number;
  kyivDay: string; // YYYY-MM-DD (Europe/Kyiv)
  groupType: RecordGroupType;
  // Дата запису/послуг (datetime) — для групи беремо найновішу (на випадок update)
  datetime: string | null;
  latestReceivedAt: string | null;
  services: string[];
  staffNames: string[];
  staffIds: Array<number | string>;
  attendanceStatus: AttendanceGroupStatus;
  rawCount: number;
};

const KYIV_TZ = 'Europe/Kyiv';

export function toKyivDayKey(date: string | Date | null | undefined): string | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA дає формат YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function parseKVItem(raw: any): any | null {
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

export function extractAttendance(e: any): number | null {
  const v =
    e?.attendance ??
    e?.data?.attendance ??
    e?.visit_attendance ??
    e?.data?.visit_attendance ??
    null;
  if (v === 1 || v === -1 || v === 0) return v;
  return null;
}

export function extractServices(e: any): any[] {
  const services =
    e?.services ??
    e?.data?.services ??
    (e?.data?.service ? [e.data.service] : null) ??
    null;
  if (Array.isArray(services)) return services;
  return [];
}

export function isConsultationTitle(title: string): boolean {
  return /консультаці/i.test(title);
}

export function isHairExtensionTitle(title: string): boolean {
  return /нарощування/i.test(title);
}

export function splitServicesByType(services: any[]): { consultation: any[]; paid: any[] } {
  const consultation: any[] = [];
  const paid: any[] = [];
  for (const s of services || []) {
    const title = (s?.title || s?.name || '').toString();
    if (!title) continue;
    if (isConsultationTitle(title)) {
      consultation.push(s);
    } else {
      paid.push(s);
    }
  }
  return { consultation, paid };
}

export function normalizeRecordEvent(raw: any): NormalizedRecordEvent | null {
  const e = parseKVItem(raw);
  if (!e) return null;

  // records:log format
  if (e.visitId && !e.body) {
    const clientId = Number(e.clientId);
    if (!clientId) return null;
    const services = extractServices(e);
    return {
      clientId,
      receivedAt: e.receivedAt ? new Date(e.receivedAt).toISOString() : (e.datetime ? new Date(e.datetime).toISOString() : null),
      datetime: e.datetime ? new Date(e.datetime).toISOString() : null,
      services,
      staffId: e.staffId ?? e.data?.staff?.id ?? null,
      staffName: e.staffName ?? e.data?.staff?.name ?? e.data?.staff?.display_name ?? null,
      attendance: extractAttendance(e),
      source: 'records:log',
    };
  }

  // webhook:log format (already wrapped)
  if (e.body?.resource === 'record') {
    const data = e.body.data || {};
    const clientId = Number(data.client?.id || data.client_id);
    if (!clientId) return null;
    const services = extractServices(data);
    return {
      clientId,
      receivedAt: e.receivedAt ? new Date(e.receivedAt).toISOString() : null,
      datetime: data.datetime ? new Date(data.datetime).toISOString() : null,
      services,
      staffId: data.staff?.id ?? data.staff_id ?? null,
      staffName: data.staff?.name ?? data.staff?.display_name ?? null,
      attendance: extractAttendance(data),
      source: 'webhook:log',
    };
  }

  return null;
}

function attendanceStatusForGroup(records: NormalizedRecordEvent[], groupDayKyiv: string | null): AttendanceGroupStatus {
  // 1) attended має найвищий пріоритет
  if (records.some((r) => r.attendance === 1)) return 'attended';

  const minusOnes = records.filter((r) => r.attendance === -1);
  if (minusOnes.length > 0) {
    // cancelled якщо -1 прилетів ДО дня візиту (Europe/Kyiv)
    // (якщо groupDayKyiv невідомий — вважаємо no-show, щоб не “прикрасити”)
    if (groupDayKyiv) {
      const anyNoShow = minusOnes.some((r) => {
        const rDay = toKyivDayKey(r.receivedAt);
        if (!rDay) return true;
        return rDay >= groupDayKyiv;
      });
      if (anyNoShow) return 'no-show';
      return 'cancelled';
    }
    return 'no-show';
  }

  if (records.some((r) => r.attendance === 0)) return 'pending';
  return 'pending';
}

export function groupClientRecordsByKyivDay(
  allRecords: NormalizedRecordEvent[],
  clientId: number,
): DailyRecordGroup[] {
  const relevant = allRecords.filter((r) => r.clientId === clientId);
  const groups = new Map<string, {
    key: string;
    clientId: number;
    kyivDay: string;
    groupType: RecordGroupType;
    records: NormalizedRecordEvent[];
    // aggregated
    services: string[];
    staffNames: string[];
    staffIds: Array<number | string>;
    datetime: string | null;
    latestReceivedAt: string | null;
  }>();

  for (const r of relevant) {
    const dtKyivDay = toKyivDayKey(r.datetime) || toKyivDayKey(r.receivedAt);
    if (!dtKyivDay) continue;

    const split = splitServicesByType(r.services);
    const variants: Array<{ groupType: RecordGroupType; services: any[] }> = [];
    if (split.consultation.length > 0) variants.push({ groupType: 'consultation', services: split.consultation });
    if (split.paid.length > 0) variants.push({ groupType: 'paid', services: split.paid });

    // якщо взагалі немає services (рідко) — віднесемо до paid, щоб не губити
    if (variants.length === 0) variants.push({ groupType: 'paid', services: [] });

    for (const v of variants) {
      const key = `${clientId}:${dtKyivDay}:${v.groupType}`;
      const existing = groups.get(key);
      const entry = existing ?? {
        key,
        clientId,
        kyivDay: dtKyivDay,
        groupType: v.groupType,
        records: [],
        services: [],
        staffNames: [],
        staffIds: [],
        datetime: null,
        latestReceivedAt: null,
      };

      const serviceTitles = (v.services || [])
        .map((s: any) => (s?.title || s?.name || '').toString().trim())
        .filter(Boolean)
        // фільтр “Запис”
        .filter((t: string) => t.toLowerCase() !== 'запис');

      for (const t of serviceTitles) {
        if (!entry.services.includes(t)) entry.services.push(t);
      }

      const staffName = (r.staffName || '').toString().trim();
      if (staffName) {
        if (!entry.staffNames.includes(staffName)) entry.staffNames.push(staffName);
      }
      if (r.staffId !== null && r.staffId !== undefined) {
        if (!entry.staffIds.includes(r.staffId)) entry.staffIds.push(r.staffId);
      }

      entry.records.push({ ...r, services: v.services });

      // datetime: беремо найновішу
      if (r.datetime) {
        if (!entry.datetime || new Date(entry.datetime).getTime() < new Date(r.datetime).getTime()) {
          entry.datetime = r.datetime;
        }
      }
      if (r.receivedAt) {
        if (!entry.latestReceivedAt || new Date(entry.latestReceivedAt).getTime() < new Date(r.receivedAt).getTime()) {
          entry.latestReceivedAt = r.receivedAt;
        }
      }

      groups.set(key, entry);
    }
  }

  const result: DailyRecordGroup[] = [];
  for (const g of groups.values()) {
    const attendanceStatus = attendanceStatusForGroup(g.records, g.kyivDay);
    result.push({
      clientId: g.clientId,
      kyivDay: g.kyivDay,
      groupType: g.groupType,
      datetime: g.datetime,
      latestReceivedAt: g.latestReceivedAt,
      services: g.services,
      staffNames: g.staffNames,
      staffIds: g.staffIds,
      attendanceStatus,
      rawCount: g.records.length,
    });
  }

  // Найновіші спочатку (по datetime, fallback по kyivDay)
  result.sort((a, b) => {
    const ta = a.datetime ? new Date(a.datetime).getTime() : new Date(a.kyivDay).getTime();
    const tb = b.datetime ? new Date(b.datetime).getTime() : new Date(b.kyivDay).getTime();
    return tb - ta;
  });

  return result;
}

// web/lib/altegio/records-grouping.ts
// Групування Altegio record events (records:log) по дню (Europe/Kyiv) та типу (consultation vs paid)
// щоб прибрати дублікати "в 4 руки" і коректно визначати attendance/state.

export type GroupType = 'consultation' | 'paid';
export type AttendanceStatus = 'arrived' | 'no-show' | 'cancelled' | 'pending';

export type NormalizedRecordEvent = {
  clientId: number;
  datetime: string | null; // дата візиту/запису
  receivedAt: string | null; // коли отримали вебхук
  services: any[];
  staffId: number | null;
  staffName: string | null;
  attendance: number | null;
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
  // агрегований attendance для сумісності (1 / -1 / 0 / null)
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

export function isConsultationServices(services: any[]): boolean {
  if (!Array.isArray(services)) return false;
  return services.some((s: any) => {
    const title = (s?.title || s?.name || '').toString();
    return /консультаці/i.test(title);
  });
}

export function groupTypeFromServices(services: any[]): GroupType {
  return isConsultationServices(services) ? 'consultation' : 'paid';
}

export function isAdminStaffName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes('адм') || n.includes('administrator') || n.includes('admin');
}

function uniqStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = (v || '').trim();
    if (!t) continue;
    if (t.toLowerCase() === 'невідомий майстер') continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function uniqServices(services: any[]): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const s of services) {
    const id = s?.id ?? '';
    const title = (s?.title || s?.name || '').toString();
    const key = `${id}:${title}`.trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function parseKvJson(raw: any): any | null {
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

export function normalizeRecordsLogItems(rawItems: any[]): NormalizedRecordEvent[] {
  const out: NormalizedRecordEvent[] = [];
  for (const raw of rawItems) {
    const e = parseKvJson(raw);
    if (!e) continue;

    const clientIdRaw = e.clientId ?? e.data?.client?.id ?? e.data?.client_id;
    const clientId = Number(clientIdRaw);
    if (!clientId) continue;

    const datetimeRaw = e.datetime ?? e.data?.datetime ?? null;
    const receivedAtRaw = e.receivedAt ?? null;

    const datetime = datetimeRaw ? new Date(datetimeRaw).toISOString() : null;
    const receivedAt = receivedAtRaw ? new Date(receivedAtRaw).toISOString() : (datetime ? datetime : null);

    const servicesRaw = e.data?.services ?? e.services ?? [];
    const services = Array.isArray(servicesRaw) ? servicesRaw : [];

    const staffId = (e.staffId ?? e.data?.staff?.id ?? e.data?.staff_id ?? null);
    const staffName = (e.staffName ?? e.data?.staff?.name ?? e.data?.staff?.display_name ?? null);

    const attendance =
      (e.attendance ?? e.visit_attendance ?? e.data?.attendance ?? e.data?.visit_attendance ?? null);

    out.push({
      clientId,
      datetime,
      receivedAt,
      services,
      staffId: staffId !== null && staffId !== undefined ? Number(staffId) : null,
      staffName: staffName ? String(staffName) : null,
      attendance: attendance !== null && attendance !== undefined ? Number(attendance) : null,
      status: e.status ?? null,
      visitId: e.visitId ?? null,
      recordId: e.recordId ?? null,
      raw: e,
    });
  }
  return out;
}

export function computeAttendanceStatus(events: NormalizedRecordEvent[]): { status: AttendanceStatus; attendance: number | null } {
  const hasArrived = events.some((e) => e.attendance === 1);
  if (hasArrived) return { status: 'arrived', attendance: 1 };

  const minusOnOrAfter: NormalizedRecordEvent[] = [];
  const minusBefore: NormalizedRecordEvent[] = [];

  for (const e of events) {
    if (e.attendance !== -1) continue;
    if (!e.datetime || !e.receivedAt) continue;
    const dayVisit = kyivDayFromISO(e.datetime);
    const dayReceived = kyivDayFromISO(e.receivedAt);
    if (!dayVisit || !dayReceived) continue;
    if (dayReceived < dayVisit) minusBefore.push(e);
    else minusOnOrAfter.push(e);
  }

  if (minusOnOrAfter.length > 0) return { status: 'no-show', attendance: -1 };
  if (minusBefore.length > 0) return { status: 'cancelled', attendance: -1 };

  const hasPending = events.some((e) => e.attendance === 0);
  if (hasPending) return { status: 'pending', attendance: 0 };

  return { status: 'pending', attendance: null };
}

export function groupRecordsByClientDay(events: NormalizedRecordEvent[]): Map<number, RecordGroup[]> {
  const byClient = new Map<number, Map<string, RecordGroup>>();

  for (const e of events) {
    const groupType = groupTypeFromServices(e.services);
    // День групи беремо з datetime (день візиту), інакше з receivedAt
    const baseIso = e.datetime || e.receivedAt;
    if (!baseIso) continue;
    const day = kyivDayFromISO(baseIso);
    if (!day) continue;

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
        services: [...e.services],
        staffIds: e.staffId ? [e.staffId] : [],
        staffNames: e.staffName ? [e.staffName] : [],
        attendanceStatus: 'pending',
        attendance: null,
        events: [e],
      });
    } else {
      existing.events.push(e);
      existing.services.push(...e.services);
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
      // attendance status
      const att = computeAttendanceStatus(g.events);
      g.attendanceStatus = att.status;
      g.attendance = att.attendance;
      // сорт: новіші спочатку
      g.events.sort((a, b) => {
        const ta = new Date(a.receivedAt || a.datetime || 0).getTime();
        const tb = new Date(b.receivedAt || b.datetime || 0).getTime();
        return tb - ta;
      });
      return g;
    }).sort((a, b) => {
      const ta = new Date(a.datetime || a.receivedAt || 0).getTime();
      const tb = new Date(b.datetime || b.receivedAt || 0).getTime();
      return tb - ta;
    });

    result.set(clientId, groups);
  }
  return result;
}

