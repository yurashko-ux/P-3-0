// web/lib/kc-cache.ts
// Спрощена версія: повертаємо null-імена, щоб не чіпати KeyCRM під час тесту /api/campaigns.
export async function getPipelineName(_id?: number | null): Promise<string | null> {
  return null;
}
export async function getStatusName(_pipelineId?: number | null, _statusId?: number | null): Promise<string | null> {
  return null;
}
