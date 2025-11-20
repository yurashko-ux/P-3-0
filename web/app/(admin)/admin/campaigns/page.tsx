// web/app/(admin)/admin/campaigns/page.tsx
import Link from "next/link";
import { kv } from "@vercel/kv";
import { headers } from "next/headers";
import { unstable_noStore as noStore } from "next/cache";
import DeleteButton from "@/components/DeleteButton";
import { kvRead, campaignKeys } from "@/lib/kv";
import { fetchKeycrmPipelines } from "@/lib/keycrm-pipelines";
import { normalizeCampaignShape } from "@/lib/campaign-shape";

// повністю вимикаємо кешування цієї сторінки
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type IdName = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};
type Counters = { v1: number; v2: number; exp: number };
type Campaign = {
  id: string;
  name: string;
  base?: IdName;
  t1?: IdName;
  t2?: IdName;
  texp?: IdName;
  counters: Counters;
  createdAt: number;

  // значення варіантів
  v1?: string;
  v2?: string;

  // інколи EXP можуть зберігатися як різні поля — лишаємо на майбутнє
  exp?: number;
  expDays?: number;
  expireDays?: number;
  expire?: number;
  vexp?: number;
  
  // статистика
  baseCardsCount?: number; // Поточна актуальна кількість карток в базовому статусі
  baseCardsCountInitial?: number; // Початкова кількість при створенні кампанії
  baseCardsTotalPassed?: number; // Загальна кількість карток, яка пройшла через базовий статус від моменту створення кампанії
  baseCardsCountUpdatedAt?: number;
  movedTotal?: number;
  movedV1?: number;
  movedV2?: number;
  movedExp?: number;
};

const IDS_KEY = "cmp:ids";
const IDS_LIST_KEY = "cmp:ids:list";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;


function logKvError(message: string, err: unknown) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[campaigns] ${message}`, err);
  }
}

async function readIds(): Promise<string[]> {
  noStore();
  try {
    const arr = await kv.get<string[] | null>(IDS_KEY);
    if (Array.isArray(arr) && arr.length) return arr.filter(Boolean);
  } catch (err) {
    logKvError("kv.get failed", err);
  }
  try {
    const list = await kvRead.lrange(IDS_LIST_KEY, 0, -1);
    if (Array.isArray(list) && list.length) return list.filter(Boolean);
  } catch (err) {
    logKvError("kv.lrange failed", err);
  }
  return [];
}

async function readFromKV(): Promise<Campaign[]> {
  noStore();
  // Використовуємо listCampaigns, який вже правильно обробляє кампанії
  try {
    const campaigns = await kvRead.listCampaigns<Campaign>();
    return campaigns
      .map((c) => normalizeCampaignShape<Campaign>(c))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  } catch (err) {
    logKvError("kvRead.listCampaigns failed", err);
    // Fallback до старого методу
    try {
      const ids = await readIds();
      if (!ids.length) return [];
      const items = await kv.mget<(Campaign | null)[]>(...ids.map(ITEM_KEY));
      const out: Campaign[] = [];
      items.forEach((it) => it && typeof it === "object" && out.push(it as Campaign));
      return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    } catch (fallbackErr) {
      logKvError("kv.mget fallback failed", fallbackErr);
      return [];
    }
  }
}

function buildBaseUrl() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}`;
}

async function readWithFallback(): Promise<Campaign[]> {
  noStore();
  // 1) напряму з KV
  const kvData = await readFromKV();
  if (kvData.length) return kvData;

  // 2) fallback — API
  try {
    const base = buildBaseUrl();
    const r = await fetch(`${base}/api/campaigns`, {
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (r.ok) {
      const payload = await r.json().catch(() => null);
      const arr = Array.isArray(payload)
        ? (payload as Campaign[])
        : Array.isArray(payload?.items)
          ? (payload.items as Campaign[])
          : [];
      if (arr.length) return arr.map((c) => normalizeCampaignShape<Campaign>(c));
    }
  } catch {}
  return [];
}

function fmtDate(ts?: number) {
  try {
    if (!ts) return "—";
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  } catch {
    return "—";
  }
}
function nn(x?: string) {
  return (x && String(x).trim()) || "—";
}

export default async function Page() {
  noStore();
  
  // Автоматичне оновлення воронок з KeyCRM при завантаженні сторінки
  try {
    await fetchKeycrmPipelines({ forceRefresh: true, persist: true });
  } catch (err) {
    // Ігноруємо помилки оновлення - використаємо кешовані дані
    if (process.env.NODE_ENV !== "production") {
      console.warn("[campaigns] Failed to refresh pipelines:", err);
    }
  }
  
  let campaigns = await readWithFallback();
  
  // Оновлюємо статистику базових карток для всіх кампаній при завантаженні сторінки
  // Робимо це синхронно, щоб оновлені дані відобразились на сторінці
  if (campaigns.length > 0) {
    try {
      // Оновлюємо статистику для всіх кампаній перед рендерингом
      const updatedCampaigns = await Promise.all(
        campaigns.map(async (c) => {
          try {
            const baseCampaign = normalizeCampaignShape<Campaign>(c);
            const { updateCampaignBaseCardsCount } = await import('@/lib/campaign-stats');
            const newCount = await updateCampaignBaseCardsCount(baseCampaign.id);
            
            // Якщо статистика оновилась, читаємо актуальну кампанію через listCampaigns
            // щоб отримати всі оновлені дані, включно з лічильниками
            if (newCount !== null) {
              // Обчислюємо переміщені картки для обчислення baseCardsTotalPassed
              const v1Count = typeof baseCampaign.counters?.v1 === 'number' ? baseCampaign.counters.v1 : (baseCampaign as any).v1_count || baseCampaign.movedV1 || 0;
              const v2Count = typeof baseCampaign.counters?.v2 === 'number' ? baseCampaign.counters.v2 : (baseCampaign as any).v2_count || baseCampaign.movedV2 || 0;
              const expCount = typeof baseCampaign.counters?.exp === 'number' ? baseCampaign.counters.exp : (baseCampaign as any).exp_count || baseCampaign.movedExp || 0;
              const movedTotal = v1Count + v2Count + expCount;
              
              // Оновлюємо baseCardsCount та baseCardsTotalPassed напряму, щоб не залежати від читання з KV
              const updated = { ...baseCampaign };
              updated.baseCardsCount = newCount;
              updated.baseCardsCountUpdatedAt = Date.now();
              // baseCardsTotalPassed = поточна кількість + переміщені картки
              updated.baseCardsTotalPassed = newCount + movedTotal;
              
              // Також оновлюємо лічильники переміщених карток
              updated.movedTotal = movedTotal;
              updated.movedV1 = v1Count;
              updated.movedV2 = v2Count;
              updated.movedExp = expCount;
              
              // Читаємо оновлену кампанію через listCampaigns для правильної обробки обгортки
              // і для отримання актуальних лічильників (на випадок, якщо вони змінилися)
              try {
                const allCampaigns = await kvRead.listCampaigns<Campaign>();
                const kvUpdated = allCampaigns.find((camp) => camp.id === baseCampaign.id || (camp as any).__index_id === baseCampaign.id);
                if (kvUpdated) {
                  // Мержимо оновлені дані з KV, зберігаючи оновлені baseCardsCount та baseCardsTotalPassed
                  // Але використовуємо актуальні лічильники з KV
                  const kvV1Count = kvUpdated.movedV1 ?? kvUpdated.counters?.v1 ?? v1Count;
                  const kvV2Count = kvUpdated.movedV2 ?? kvUpdated.counters?.v2 ?? v2Count;
                  const kvExpCount = kvUpdated.movedExp ?? kvUpdated.counters?.exp ?? expCount;
                  const kvMovedTotal = kvV1Count + kvV2Count + kvExpCount;
                  
                  const mergedBaseTotal =
                    typeof kvUpdated.baseCardsTotalPassed === 'number'
                      ? kvUpdated.baseCardsTotalPassed
                      : updated.baseCardsTotalPassed ?? newCount + kvMovedTotal;
                  return { 
                    ...updated, 
                    ...kvUpdated,
                    baseCardsCount: newCount, // Зберігаємо оновлений baseCardsCount
                    baseCardsTotalPassed: Math.max(mergedBaseTotal, newCount + kvMovedTotal),
                    movedTotal: kvMovedTotal, // Використовуємо актуальні лічильники з KV
                    movedV1: kvV1Count,
                    movedV2: kvV2Count,
                    movedExp: kvExpCount,
                  } as Campaign;
                }
              } catch {
                // Якщо не вдалося через listCampaigns, спробуємо через @vercel/kv
                const keysToTry = [
                  campaignKeys.ITEM_KEY(baseCampaign.id),
                  campaignKeys.CMP_ITEM_KEY(baseCampaign.id),
                  campaignKeys.LEGACY_ITEM_KEY(baseCampaign.id),
                ];
                
                for (const key of keysToTry) {
                  try {
                    const kvUpdated = await kv.get<Campaign>(key);
                    if (kvUpdated) {
                      // Мержимо оновлені дані з KV
                      const kvV1Count = kvUpdated.movedV1 ?? kvUpdated.counters?.v1 ?? v1Count;
                      const kvV2Count = kvUpdated.movedV2 ?? kvUpdated.counters?.v2 ?? v2Count;
                      const kvExpCount = kvUpdated.movedExp ?? kvUpdated.counters?.exp ?? expCount;
                      const kvMovedTotal = kvV1Count + kvV2Count + kvExpCount;
                      
                      const mergedBaseTotal =
                        typeof kvUpdated.baseCardsTotalPassed === 'number'
                          ? kvUpdated.baseCardsTotalPassed
                          : updated.baseCardsTotalPassed ?? newCount + kvMovedTotal;
                      return { 
                        ...updated, 
                        ...kvUpdated,
                        baseCardsCount: newCount,
                        baseCardsTotalPassed: Math.max(mergedBaseTotal, newCount + kvMovedTotal),
                        movedTotal: kvMovedTotal,
                        movedV1: kvV1Count,
                        movedV2: kvV2Count,
                        movedExp: kvExpCount,
                      } as Campaign;
                    }
                  } catch {
                    // Продовжуємо наступний ключ
                  }
                }
              }
              
              // Якщо не вдалося отримати оновлені дані з KV, зберігаємо монотонний максимум
              const previousTotal =
                typeof baseCampaign.baseCardsTotalPassed === 'number'
                  ? baseCampaign.baseCardsTotalPassed
                  : baseCampaign.baseCardsCountInitial || newCount;
              updated.baseCardsTotalPassed = Math.max(previousTotal, newCount + movedTotal);
              return updated as Campaign;
            }
            return c;
          } catch {
            // Якщо помилка - повертаємо оригінальну кампанію
            return c;
          }
        })
      );
      
      campaigns = updatedCampaigns;
    } catch (err) {
      // Якщо помилка оновлення - використовуємо оригінальні кампанії
      if (process.env.NODE_ENV !== 'production') {
        console.warn("[campaigns] Failed to refresh stats:", err);
      }
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Кампанії</h1>
        <div className="flex items-start gap-3">
          <div className="flex gap-3">
            <Link
              href="/admin/campaigns/new"
              className="rounded-lg bg-blue-600 text-white px-4 py-2 font-medium shadow hover:bg-blue-700"
            >
              + Нова кампанія
            </Link>
            <Link
              href={`/admin/campaigns?t=${Date.now()}`}
              className="rounded-lg border px-4 py-2 shadow-sm"
            >
              Оновити
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full table-fixed">
          <thead>
            <tr className="text-left text-slate-600 text-sm border-b">
              <th className="px-4 py-3 w-[180px]">Дата</th>
              <th className="px-2 py-3 w-[160px]">Назва</th>
              <th className="px-2 py-3 w-[200px]">Базова Воронка</th>
              <th className="px-2 py-3 w-[160px]">Базовий Статус</th>
              <th className="px-2 py-3 w-[120px]">Варіант</th>
              <th className="px-2 py-3 w-[260px]">Цільова воронка</th>
              <th className="px-2 py-3 w-[280px]">Цільовий статус</th>
              <th className="px-4 py-3 w-[120px] text-right">Дії</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  Порожньо. Створіть першу кампанію.
                </td>
              </tr>
            ) : (
              campaigns.map((c) => (
                <tr key={c.id} className="border-b align-top">
                  {/* Дата */}
                  <td className="px-4 py-3 text-sm text-slate-800">
                    <div>{fmtDate(c.createdAt)}</div>
                    <div className="text-slate-400 text-xs">#{c.id}</div>
                  </td>

                  {/* Назва */}
                  <td className="px-2 py-3 text-sm">{nn(c.name)}</td>

                  {/* База */}
                  <td className="px-2 py-3 text-sm">{nn(c.base?.pipelineName)}</td>
                  <td className="px-2 py-3 text-sm">
                    {(() => {
                      const statusName = nn(c.base?.statusName);
                      // Показуємо поточну актуальну кількість карток в базовій воронці
                      const currentCount = typeof c.baseCardsCount === 'number' ? c.baseCardsCount : null;
                      // Показуємо загальну кількість карток, яка пройшла через базовий статус
                      const totalPassed = typeof c.baseCardsTotalPassed === 'number' ? c.baseCardsTotalPassed : null;
                      
                      if (currentCount !== null && totalPassed !== null) {
                        return (
                          <>
                            {statusName} <span className="text-slate-400">({totalPassed}/{currentCount})</span>
                          </>
                        );
                      } else if (currentCount !== null) {
                        return (
                          <>
                            {statusName} <span className="text-slate-400">({currentCount})</span>
                          </>
                        );
                      }
                      return statusName;
                    })()}
                  </td>

                  {/* Варіант — V1/V2/EXP значення */}
                  <td className="px-2 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <div>
                        <span className="text-slate-500 mr-2">V1</span>
                        {nn(c.v1)}
                      </div>
                      <div>
                        <span className="text-slate-500 mr-2">V2</span>
                        {nn(c.v2)}
                      </div>
                      <div>
                        <span className="text-slate-500 mr-2">EXP</span>
                        {(() => {
                          const v =
                            (c as any)?.exp ??          // ← тепер спочатку читаємо exp
                            (c as any)?.expDays ??
                            (c as any)?.expireDays ??
                            (c as any)?.expire ??
                            (c as any)?.vexp;
                          return v == null ? "—" : String(v);
                        })()}
                      </div>
                    </div>
                  </td>

                  {/* Цільова воронка — вертикально V1/V2/EXP */}
                  <td className="px-2 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <div>
                        <span className="text-slate-500 mr-2">V1</span>
                        {nn(c.t1?.pipelineName)}
                      </div>
                      <div>
                        <span className="text-slate-500 mr-2">V2</span>
                        {nn(c.t2?.pipelineName)}
                      </div>
                      <div>
                        <span className="text-slate-500 mr-2">EXP</span>
                        {nn(c.texp?.pipelineName)}
                      </div>
                    </div>
                  </td>

                  {/* Цільовий статус — вертикально з лічильниками */}
                  <td className="px-2 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <div>
                        <span className="text-slate-500 mr-2">V1</span>
                        {(() => {
                          const statusName = nn(c.t1?.statusName);
                          const movedV1 = c.movedV1 ?? c.counters?.v1 ?? 0;
                          if (statusName && typeof movedV1 === 'number') {
                            return (
                              <>
                                {statusName} <span className="text-slate-400">({movedV1})</span>
                              </>
                            );
                          }
                          return statusName;
                        })()}
                      </div>
                      <div>
                        <span className="text-slate-500 mr-2">V2</span>
                        {(() => {
                          const statusName = nn(c.t2?.statusName);
                          const movedV2 = c.movedV2 ?? c.counters?.v2 ?? 0;
                          if (statusName && typeof movedV2 === 'number') {
                            return (
                              <>
                                {statusName} <span className="text-slate-400">({movedV2})</span>
                              </>
                            );
                          }
                          return statusName;
                        })()}
                      </div>
                      <div>
                        <span className="text-slate-500 mr-2">EXP</span>
                        {(() => {
                          const statusName = nn(c.texp?.statusName);
                          const movedExp = c.movedExp ?? c.counters?.exp ?? 0;
                          if (statusName && typeof movedExp === 'number') {
                            return (
                              <>
                                {statusName} <span className="text-slate-400">({movedExp})</span>
                              </>
                            );
                          }
                          return statusName;
                        })()}
                      </div>
                    </div>
                  </td>

                  {/* Дії */}
                  <td className="px-4 py-3 text-right">
                    <DeleteButton id={c.id} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
