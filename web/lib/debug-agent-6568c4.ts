/**
 * Діагностика сесії 6568c4: ingest + append `web/.debug-6568c4.ndjson` + опційний console.
 * На Vercel: `fs` не пише в репозиторій; увімкніть `DEBUG_AGENT_6568C4=1` і дивіться Function Logs (`[DEBUG-6568c4]`).
 * Локально: у `next dev` також лог у термінал (NODE_ENV !== production).
 */
import { appendFileSync, mkdirSync } from 'fs';
import { basename, dirname, join } from 'path';

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
  if (process.env.DEBUG_AGENT_6568C4 === '1' || process.env.NODE_ENV !== 'production') {
    console.log('[DEBUG-6568c4]', line.trim());
  }
  fetch(INGEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6568c4' },
    body: line.trim(),
  }).catch(() => {});
  try {
    const cwd = process.cwd();
    /** Завжди `web/.debug-6568c4.ndjson`: при `next dev` з `web/` cwd закінчується на `web`; з кореня репо — підкаталог `web/`. Без `web/web/`. */
    const webNdjson =
      basename(cwd) === 'web'
        ? join(cwd, '.debug-6568c4.ndjson')
        : join(cwd, 'web', '.debug-6568c4.ndjson');
    const mirrors = [
      webNdjson,
      join(cwd, '..', '.cursor', 'debug-6568c4.log'),
      join(cwd, '.cursor', 'debug-6568c4.log'),
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
