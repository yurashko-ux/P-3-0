// web/lib/lookups.ts
export type Pipeline = { id: string; name: string };
export type Status = { id: string; name: string; pipelineId: string };

export const PIPELINES: Pipeline[] = [
  { id: "p-1", name: "Нові Ліди" },
  { id: "p-2", name: "Клієнти Інші послуги" },
];

export const STATUSES: Status[] = [
  { id: "s-1", name: "Новий", pipelineId: "p-1" },
  { id: "s-2", name: "Перший контакт", pipelineId: "p-2" },
];

export function pipelineNameById(id?: string) {
  return PIPELINES.find(p => p.id === id)?.name || "";
}

export function statusNameById(id?: string) {
  return STATUSES.find(s => s.id === id)?.name || "";
}

export function statusesForPipeline(pipelineId?: string) {
  return STATUSES.filter(s => s.pipelineId === pipelineId);
}
