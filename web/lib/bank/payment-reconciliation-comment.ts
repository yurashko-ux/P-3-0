/** Рядки, які додаються автоматично з даних monobank / переміщення (не ручний коментар адміна). */
const AUTO_RECONCILIATION_COMMENT_PREFIXES = [
  "Дата банківського платежу:",
  "Контрагент:",
  "Призначення банку:",
  "Опис:",
  "Залишок на банківському рахунку",
  "Переміщення коштів з рахунку",
] as const;

function cleanText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

/** Прибирає автоматичні блоки з коментаря Altegio, залишає лише текст адміна. */
export function stripAutoReconciliationCommentLines(text: string | null | undefined): string | null {
  const raw = cleanText(text);
  if (!raw) return null;

  const blocks = raw.split(/\n\n+/);
  const manualBlocks: string[] = [];

  for (const block of blocks) {
    const line = block.trim();
    if (!line) continue;
    const isAuto = AUTO_RECONCILIATION_COMMENT_PREFIXES.some((prefix) => line.startsWith(prefix));
    if (!isAuto) manualBlocks.push(line);
  }

  return manualBlocks.length > 0 ? manualBlocks.join("\n\n") : null;
}

/** Ручний коментар адміна до зведення (без автопідпису банку / переміщення). */
export function extractAdminReconciliationComment(params: {
  pendingNote?: string | null;
  altegioComment?: string | null;
}): string | null {
  const fromPending = stripAutoReconciliationCommentLines(params.pendingNote);
  if (fromPending) return fromPending;

  return stripAutoReconciliationCommentLines(params.altegioComment);
}
