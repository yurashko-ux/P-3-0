import { query } from '../db';
import { AltegrioClient, AltegrioClientOptions } from '../integrations/altegrio';
import { logger } from '../logger';

export interface RunAltegrioSyncOptions {
  endpoint?: string;
  params?: Record<string, unknown>;
  client?: AltegrioClient;
  clientOptions?: AltegrioClientOptions;
}

export interface SyncRunResult {
  runId: string;
  status: 'completed' | 'failed';
  payloadChunks: number;
}

export async function runAltegrioSync(
  options: RunAltegrioSyncOptions = {},
): Promise<SyncRunResult> {
  const client =
    options.client ?? new AltegrioClient(options.clientOptions ?? {});
  const endpoint = options.endpoint ?? '/clients';
  const params = options.params ?? {};
  const startedAt = new Date();

  const runInsert = await query<{ id: string }>(
    `INSERT INTO sync_runs (source, status, started_at)
     VALUES ($1, $2, $3)
     RETURNING id`,
    ['altegrio', 'running', startedAt],
  );

  const runId = runInsert.rows[0].id;
  const payload: unknown[] = [];

  try {
    for await (const page of client.paginate(endpoint, params)) {
      payload.push(page);
    }

    await query(
      `UPDATE sync_runs
         SET status = $1,
             payload = $2::jsonb,
             completed_at = $3
       WHERE id = $4`,
      ['completed', JSON.stringify(payload), new Date(), runId],
    );

    logger.info(
      {
        runId,
        endpoint,
        chunks: payload.length,
      },
      'Altegrio sync completed',
    );

    return {
      runId,
      status: 'completed',
      payloadChunks: payload.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    await query(
      `UPDATE sync_runs
         SET status = $1,
             error = $2,
             payload = $3::jsonb,
             completed_at = $4
       WHERE id = $5`,
      ['failed', message, JSON.stringify(payload), new Date(), runId],
    );

    logger.error(
      {
        runId,
        endpoint,
        error,
      },
      'Altegrio sync failed',
    );

    return {
      runId,
      status: 'failed',
      payloadChunks: payload.length,
    };
  }
}
