// The generated client's runtime, kept as template text so generateClientCode
// only composes it with the per-content-type members. Backticks and `${`
// inside the emitted code are escaped for the outer template literal.

export const CLIENT_CONFIG_INTERFACE = `interface StrapiClientConfig {
  readonly baseUrl: string;
  // A function is resolved per request (e.g. build-time vs runtime tokens)
  readonly token: string | (() => string);
  readonly fetch?: typeof fetch;
  // Off by default. Retries network failures and retryOnStatuses responses
  // with linear backoff (attempt * baseDelayMs).
  readonly retry?: {
    readonly maxAttempts?: number;
    readonly baseDelayMs?: number;
    readonly retryOnStatuses?: readonly number[];
  };
  // Merged into every request's query string; per-request params win
  readonly defaultParams?: Record<string, unknown>;
}`;

export const PAGINATION_META_INTERFACE = `export interface StrapiPaginationMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly total: number;
}`;

export const LIST_RESPONSE_INTERFACE = `export interface StrapiListResponse<T> {
  readonly data: readonly T[];
  readonly meta: { readonly pagination: StrapiPaginationMeta };
}`;

export const REQUEST_OPTIONS_INTERFACE = `interface RequestOptions<P = Record<string, unknown>> {
  readonly filters?: Record<string, unknown>;
  readonly populate?: P | string;
  readonly pagination?: { readonly page?: number; readonly pageSize?: number };
  readonly sort?: string | readonly string[];
  readonly fields?: readonly string[];
  readonly status?: 'published' | 'draft';
  readonly locale?: string;
  readonly params?: Record<string, unknown>;
  // Extra fetch init merged into the request (AbortSignal, Next.js
  // next/cache options, extra headers - Authorization always wins)
  readonly request?: RequestInit;
}`;

export const VIEW_REQUEST_OPTIONS_INTERFACE = `interface ViewRequestOptions {
  readonly status?: 'published' | 'draft';
  readonly locale?: string;
  readonly params?: Record<string, unknown>;
  readonly request?: RequestInit;
}`;

export const RETRY_DEFAULTS = `const DEFAULT_RETRY_BASE_DELAY_MS = 300;
const DEFAULT_RETRY_STATUSES: readonly number[] = [429, 502, 503, 504];`;

// Body of createStrapiClient up to (not including) the returned object;
// `validationCode` is the target adapter's safeParse branch
export const buildRuntimeCore = (validationCode: string): string =>
  `export const createStrapiClient = (config: StrapiClientConfig): StrapiClient => {
  const { baseUrl, token, fetch: customFetch = fetch, retry, defaultParams } = config;

  const resolveToken = (): string => (typeof token === 'function' ? token() : token);

  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const isNetworkFailure = (error: unknown): boolean =>
    error instanceof TypeError ||
    (error instanceof Error && error.message.includes('fetch failed'));

  // Per-request options that were not given must not shadow defaultParams:
  // spreading { locale: undefined } over { locale: 'en' } would drop the default
  const withoutUndefined = (params: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));

  const doFetch = async (url: string, init: RequestInit): Promise<Response> => {
    const maxAttempts = Math.max(1, retry?.maxAttempts ?? 1);
    const baseDelayMs = Math.max(0, retry?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
    const retryOnStatuses = retry?.retryOnStatuses ?? DEFAULT_RETRY_STATUSES;

    let attempt = 0;
    for (;;) {
      attempt += 1;
      let response: Response;
      try {
        response = await customFetch(url, init);
      } catch (error) {
        if (attempt < maxAttempts && isNetworkFailure(error)) {
          await delay(baseDelayMs * attempt);
          continue;
        }
        throw error;
      }
      if (!response.ok && attempt < maxAttempts && retryOnStatuses.includes(response.status)) {
        await delay(baseDelayMs * attempt);
        continue;
      }
      return response;
    }
  };

  // Headers may arrive as a Headers instance, a tuple list or a record; the
  // Headers API normalizes all three. Authorization always wins.
  const buildInit = (request?: RequestInit): RequestInit => {
    const headers = new Headers(request?.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    headers.set('Authorization', \`Bearer \${resolveToken()}\`);
    return { ...request, headers };
  };

  const throwRequestError = async (response: Response, url: string): Promise<never> => {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // non-JSON body - keep null
    }
    throw new StrapiRequestError({ status: response.status, url, body });
  };

  const fetchEndpoint = async <P>(
    endpoint: string,
    defaultPopulate: Record<string, unknown>,
    options?: RequestOptions<P>,
  ): Promise<{ url: string; response: Response; json: { data: unknown; meta?: unknown } } | null> => {
    const populate = options?.populate ?? defaultPopulate;
    const params = serializeQuery({
      ...defaultParams,
      ...withoutUndefined({
        populate,
        filters: options?.filters,
        fields: options?.fields,
        pagination: options?.pagination,
        sort: options?.sort,
        status: options?.status,
        locale: options?.locale,
      }),
      ...options?.params,
    });

    const url = \`\${baseUrl}/api/\${endpoint}\${params ? \`?\${params}\` : ''}\`;
    const response = await doFetch(url, buildInit(options?.request));

    // By-key lookups treat not-found (missing, soft-deleted, unpreviewable
    // draft) as null rather than an error
    if (response.status === 404) return null;
    if (!response.ok) await throwRequestError(response, url);

    const json = await response.json() as { data: unknown; meta?: unknown };
    return { url, response, json };
  };

  const validate = <T>(
    schema: unknown,
    data: unknown,
    endpoint: string,
    status: number,
  ): T => {${validationCode}
  };

  const request = async <T, P = Record<string, unknown>>(
    endpoint: string,
    schema: unknown,
    defaultPopulate: Record<string, unknown>,
    options?: RequestOptions<P>,
  ): Promise<T | null> => {
    const result = await fetchEndpoint(endpoint, defaultPopulate, options);
    if (result === null) return null;
    return validate<T>(schema, result.json.data, endpoint, result.response.status);
  };

  const requestList = async <T, P = Record<string, unknown>>(
    endpoint: string,
    schema: unknown,
    defaultPopulate: Record<string, unknown>,
    options?: RequestOptions<P>,
  ): Promise<StrapiListResponse<T>> => {
    const result = await fetchEndpoint(endpoint, defaultPopulate, options);
    // Lists never legitimately 404 - a null here means a broken base URL
    if (result === null) {
      throw new StrapiRequestError({ status: 404, url: \`\${baseUrl}/api/\${endpoint}\`, body: null });
    }
    const { response, json } = result;
    const data = validate<T[]>(schema, json.data, endpoint, response.status);
    const meta = json.meta as { pagination?: StrapiPaginationMeta } | undefined;
    if (!meta?.pagination) {
      throw new Error(
        \`Strapi response for "\${endpoint}" is missing meta.pagination - \` +
          'is a proxy or middleware rewriting the response body?',
      );
    }
    return { data, meta: { pagination: meta.pagination } };
  };`;

export const VIEW_REQUEST_RUNTIME = `
  // BFF view lookups validate the FULL envelope ({ data, meta }) with the
  // view's generated schema and return it typed; 404 -> null
  const viewRequest = async <T>(
    endpoint: string,
    schema: unknown,
    options?: ViewRequestOptions,
  ): Promise<T | null> => {
    const params = serializeQuery({
      ...defaultParams,
      ...withoutUndefined({ status: options?.status, locale: options?.locale }),
      ...options?.params,
    });
    const url = \`\${baseUrl}/api/bff-views\${endpoint}\${params ? \`?\${params}\` : ''}\`;
    const response = await doFetch(url, buildInit(options?.request));

    if (response.status === 404) return null;
    if (!response.ok) await throwRequestError(response, url);

    const json = await response.json();
    if (schema === null) return json as T;
    return validate<T>(schema, json, endpoint, response.status);
  };`;
