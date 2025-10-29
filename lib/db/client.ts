import {
  Pool,
  PoolClient,
  QueryConfig,
  QueryResult,
  QueryResultRow,
} from 'pg';

let pool: Pool | null = null;

export interface DatabaseOptions {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
}

function createPool(options: DatabaseOptions = {}): Pool {
  const connectionString =
    options.connectionString ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Please configure the connection string in your environment.',
    );
  }

  return new Pool({
    connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    ssl:
      connectionString.includes('sslmode=disable') ||
      connectionString.includes('sslmode=allow')
        ? false
        : { rejectUnauthorized: false },
  });
}

export function getPool(options: DatabaseOptions = {}): Pool {
  if (!pool) {
    pool = createPool(options);
  }

  return pool;
}

export async function withConnection<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: DatabaseOptions = {},
): Promise<T> {
  const client = await getPool(options).connect();

  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  queryText: string | QueryConfig,
  values?: ReadonlyArray<unknown>,
  options: DatabaseOptions = {},
): Promise<QueryResult<T>> {
  if (typeof queryText === 'string') {
    return getPool(options).query<T>(queryText, values as unknown[] | undefined);
  }

  return getPool(options).query<T>(queryText);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
