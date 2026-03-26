/**
 * Діагностика сесії 6568c4: ingest (локальний Cursor) + append NDJSON.
 * `.cursor/debug-6568c4.log` у .gitignore — IDE може не показувати агенту; тому дублюємо у `web/.debug-6568c4.ndjson`.
 * (Vercel: fetch до 127.0.0.1 не працює; fs у проєкті — лише локальний dev.)
 */
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const INGEST = 'http://127.0.0.1:7242/ingest/e4d350b7-7929-4c21-a27b-c6c6190d2dda';

export function logDebug6568c4(entry: {
  location: string;
  message: string;
  data?: Record<string, unknown>;
  hypothesisId: string;
}): void {
  const payload = {
    sessionId: '6568c4',
    timestamp: Date.now(),
    ...entry,
  };
  const line = JSON.stringify(payload) + '\n';
  fetch(INGEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6568c4' },
    body: line.trim(),
  }).catch(() => {});
  try {
    const mirrors = [
      join(process.cwd(), '.debug-6568c4.ndjson'),
      join(process.cwd(), 'web', '.debug-6568c4.ndjson'),
      join(process.cwd(), '..', '.cursor', 'debug-6568c4.log'),
      join(process.cwd(), '.cursor', 'debug-6568c4.log'),
    ];
    for (const logPath of mirrors) {
      try {
        mkdirSync(dirname(logPath), { recursive: true });
        appendFileSync(logPath, line);
      } catch {
        /* наступний шлях / недоступний диск */
      }
    }
  } catch {
    /* ignore */
  }
}
