// Які приходи лишити непроведеними, коли в касі менше, ніж за платежами.
// Вихідні проводимо завжди. Беремо найменшу суму приходів, яка не менша за недостачу:
// один платіж, якщо він покриває, інакше кілька.

export type CashHoldCandidate = {
  key: string;
  direction: "in" | "out";
  amount: number;
};

const KOP = 100;
/** Межа динамічного підбору. Більшу недостачу закриваємо жадібно, щоб не тримати величезний масив. */
const MAX_DP_KOP = 5_000_000;

function toKop(amount: number): number {
  return Math.round((Number(amount) || 0) * KOP);
}

function minCover(items: Array<{ key: string; kop: number }>, target: number): number[] | null {
  const total = items.reduce((sum, row) => sum + row.kop, 0);
  if (total < target || items.length === 0) return null;
  const maxItem = items.reduce((max, row) => Math.max(max, row.kop), 0);
  const limit = target + maxItem - 1;
  if (limit > MAX_DP_KOP) return greedyCover(items, target);

  const reachable = new Uint8Array(limit + 1);
  const prevSum = new Int32Array(limit + 1);
  const prevItem = new Int32Array(limit + 1);
  prevSum.fill(-1);
  prevItem.fill(-1);
  reachable[0] = 1;
  for (let i = 0; i < items.length; i++) {
    const kop = items[i].kop;
    for (let sum = limit - kop; sum >= 0; sum--) {
      if (!reachable[sum]) continue;
      const next = sum + kop;
      if (reachable[next]) continue;
      reachable[next] = 1;
      prevSum[next] = sum;
      prevItem[next] = i;
    }
  }
  let best = -1;
  for (let sum = target; sum <= limit; sum++) {
    if (!reachable[sum]) continue;
    best = sum;
    break;
  }
  if (best < 0) return null;
  const indexes: number[] = [];
  let cursor = best;
  while (cursor > 0) {
    const item = prevItem[cursor];
    if (item < 0) break;
    indexes.push(item);
    cursor = prevSum[cursor];
  }
  return indexes;
}

function greedyCover(items: Array<{ key: string; kop: number }>, target: number): number[] | null {
  const order = items
    .map((row, index) => ({ index, kop: row.kop }))
    .sort((a, b) => b.kop - a.kop || a.index - b.index);
  const chosen: number[] = [];
  let sum = 0;
  for (const row of order) {
    if (sum >= target) break;
    chosen.push(row.index);
    sum += row.kop;
  }
  if (sum < target) return null;
  let dropped = true;
  while (dropped) {
    dropped = false;
    for (let i = 0; i < chosen.length; i++) {
      const kop = items[chosen[i]].kop;
      if (sum - kop < target) continue;
      sum -= kop;
      chosen.splice(i, 1);
      dropped = true;
      break;
    }
  }
  return chosen;
}

/** Ключі приходів, які не проводимо. Порожньо, якщо недостачі немає. */
export function selectInflowsToHold(candidates: CashHoldCandidate[], shortage: number): string[] {
  const gap = toKop(shortage);
  if (!(gap > 0)) return [];
  const inflows = candidates
    .filter((row) => row.direction === "in")
    .map((row) => ({ key: row.key, kop: toKop(row.amount) }))
    .filter((row) => row.kop > 0);
  if (inflows.length === 0) return [];

  const total = inflows.reduce((sum, row) => sum + row.kop, 0);
  if (total < gap) return inflows.map((row) => row.key);

  const single = inflows
    .filter((row) => row.kop >= gap)
    .sort((a, b) => a.kop - b.kop || a.key.localeCompare(b.key))[0];
  const smaller = inflows.filter((row) => row.kop < gap);
  const comboIndexes = minCover(smaller, gap);
  const comboSum = comboIndexes ? comboIndexes.reduce((sum, index) => sum + smaller[index].kop, 0) : Infinity;

  if (comboIndexes && (!single || comboSum < single.kop)) {
    return comboIndexes.map((index) => smaller[index].key);
  }
  if (single) return [single.key];
  return inflows.map((row) => row.key);
}
