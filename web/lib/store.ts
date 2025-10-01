// web/lib/store.ts
// Просте in-memory сховище, яке працює на Vercel під час рантайму.
// Щоб підключити реальне KV/БД — заміни внутрішню реалізацію на свою.
// Типи спільні з ClientList.tsx

export type Counters = { v1?: number; v2?: number; exp?: number };
export type BaseInfo = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};
export type Campaign = {
  id: string;
  name?: string;
  v1?: string;
  v2?: string;
  base?: BaseInfo;
  counters?: Counters;
  deleted?: boolean;
  createdAt?: number;
};

type MemoryDB = { items: Campaign[] };

function getMem(): MemoryDB {
  const g = globalThis as any;
  if (!g.__CAMPAIGNS_MEM__) g.__CAMPAIGNS_MEM__ = { items: [] as Campaign[] };
  return g.__CAMPAIGNS_MEM__ as MemoryDB;
}

export const store = {
  async getAll(): Promise<Campaign[]> {
    return [...getMem().items];
  },

  async create(item: Campaign): Promise<void> {
    const db = getMem();
    // не дублюємо ID
    db.items = db.items.filter((x) => x.id !== item.id);
    db.items.unshift(item);
  },

  async remove(id: string): Promise<void> {
    const db = getMem();
    const found = db.items.find((x) => x.id === id);
    if (found) found.deleted = true;
  },
};
