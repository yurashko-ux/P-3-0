// web/lib/lookups.ts
export type Pipeline = { id: string; name: string };
export type Status = { id: string; name: string; pipelineId: string };

export const PIPELINES: Pipeline[] = [
  { id: "p-1", name: "Нові Ліди" },
  { id: "p-2", name: "Клієнти Інші послуги" },
  { id: "p-3", name: "Втрачені Клієнти" },
  { id: "p-4", name: "Запит ціни" }, // щоби збігалося з макетом у блоці Expire
];

export const STATUSES: Status[] = [
  { id: "s-1", name: "Новий",           pipelineId: "p-1" },
  { id: "s-2", name: "Перший контакт",  pipelineId: "p-2" },
  { id: "s-3", name: "Запит Ціни",      pipelineId: "p-1" },
  { id: "s-4", name: "Успішний",        pipelineId: "p-2" },
  { id: "s-5", name: "Перший контакт",  pipelineId: "p-3" },
];

export function pipelineNameById(id?: string) {
  return PIPELINES.find(p => p.id === id)?.name || "";
}
export function statusNameById(id?: string) {
  return STATUSES.find(s => s.id === id)?.name || "";
}
export function statusesForPipeline(pipelineId?: string) {
  return pipelineId ? STATUSES.filter(s => s.pipelineId === pipelineId) : [];
}
