import axios, {
  AxiosHeaders,
  AxiosInstance,
  AxiosRequestConfig,
} from 'axios';
import pRetry from 'p-retry';

import { logger } from '../../logger';

export interface AltegrioClientOptions {
  baseURL?: string;
  apiKey?: string;
  apiSecret?: string;
  timeoutMs?: number;
  maxRetries?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta?: {
    page?: number;
    per_page?: number;
    next_page?: number | null;
    total_pages?: number;
    has_more?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type RequestConfig = AxiosRequestConfig & { retryKey?: string };

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 3;

export class AltegrioClient {
  private readonly axios: AxiosInstance;
  private readonly pageSize: number;
  private readonly maxRetries: number;

  constructor(options: AltegrioClientOptions = {}) {
    const baseURL =
      options.baseURL ?? process.env.ALTEGRIO_BASE_URL ?? 'https://api.alteg.io/v1';
    const apiKey = options.apiKey ?? process.env.ALTEGRIO_API_KEY;
    const apiSecret = options.apiSecret ?? process.env.ALTEGRIO_API_SECRET;

    if (!apiKey || !apiSecret) {
      logger.warn(
        'Altegrio credentials are missing. Set ALTEGRIO_API_KEY and ALTEGRIO_API_SECRET to enable API calls.',
      );
    }

    this.axios = axios.create({
      baseURL,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT,
    });

    this.axios.interceptors.request.use((config) => {
      const headers = AxiosHeaders.from(config.headers ?? {});
      headers.set('X-API-KEY', apiKey ?? '');
      headers.set('X-API-SECRET', apiSecret ?? '');
      headers.set('Accept', 'application/json');

      config.headers = headers;

      return config;
    });

    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.maxRetries = options.maxRetries ?? DEFAULT_RETRIES;
  }

  async request<T = unknown>(config: RequestConfig): Promise<T> {
    const retryKey = config.retryKey ?? config.url ?? 'altegrio-request';

    return pRetry(
      async () => {
        const response = await this.axios.request<T>(config);
        return response.data;
      },
      {
        retries: this.maxRetries,
        onFailedAttempt: (error) => {
          logger.warn(
            {
              error: error.message,
              attempt: error.attemptNumber,
              retriesLeft: error.retriesLeft,
              retryKey,
            },
            'Retrying Altegrio request after failure',
          );
        },
      },
    );
  }

  async get<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config: Omit<RequestConfig, 'url' | 'method'> = {},
  ): Promise<T> {
    return this.request<T>({
      ...config,
      url,
      method: 'GET',
      params,
    });
  }

  async *paginate<T = unknown>(
    url: string,
    params: Record<string, unknown> = {},
    config: Omit<RequestConfig, 'url' | 'method' | 'params'> = {},
  ): AsyncGenerator<PaginatedResponse<T>, void, unknown> {
    let page = Number(params.page ?? 1);
    const perPage = Number(params.per_page ?? params.limit ?? this.pageSize);

    while (true) {
      const response = await this.get<PaginatedResponse<T>>(url, {
        ...params,
        page,
        per_page: perPage,
      }, config);

      yield response;

      if (!this.hasMore(response)) {
        break;
      }

      page = this.getNextPage(response) ?? page + 1;
    }
  }

  private hasMore<T>(response: PaginatedResponse<T>): boolean {
    const meta = response.meta ?? {};
    if (typeof meta.has_more === 'boolean') {
      return meta.has_more;
    }

    if (typeof meta.next_page === 'number') {
      return meta.next_page > (meta.page ?? 0);
    }

    if (typeof meta.total_pages === 'number' && typeof meta.page === 'number') {
      return meta.page < meta.total_pages;
    }

    return false;
  }

  private getNextPage<T>(response: PaginatedResponse<T>): number | null {
    const meta = response.meta ?? {};

    if (typeof meta.next_page === 'number') {
      return meta.next_page;
    }

    if (
      typeof meta.page === 'number' &&
      typeof meta.total_pages === 'number' &&
      meta.page < meta.total_pages
    ) {
      return meta.page + 1;
    }

    return null;
  }
}
