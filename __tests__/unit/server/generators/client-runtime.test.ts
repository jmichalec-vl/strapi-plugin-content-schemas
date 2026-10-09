import { describe, it, expect, vi, beforeEach } from 'vitest';
import ts from 'typescript';
import { z } from 'zod';

import {
  generateClientCode,
  generateErrorClassCode,
  generateQueryStringCode,
  generateRequestErrorCode,
} from '../../../../server/src/generators/client-generator';
import '../../../../server/src/mappers/zod/index';
import type { ContentTypeIR } from '../../../../server/src/types';

// The client only exists as emitted code: compile it and run it against a
// mocked fetch so retry, 404, envelope and header behaviour are exercised on
// the exact runtime consumers receive
const ARTICLE: ContentTypeIR = {
  uid: 'api::article.article',
  singularName: 'article',
  pluralName: 'articles',
  displayName: 'Article',
  kind: 'collectionType',
  attributes: [
    { name: 'documentId', type: 'string', required: true },
    { name: 'title', type: 'string', required: true },
  ],
};

type ModuleExports = Record<string, unknown>;

const compile = (source: string, requireShim: (name: string) => ModuleExports): ModuleExports => {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleObj: { exports: ModuleExports } = { exports: {} };
  new Function('exports', 'module', 'require', js)(moduleObj.exports, moduleObj, requireShim);
  return moduleObj.exports;
};

const loadClient = () => {
  const ArticleSchema = z.object({ documentId: z.string(), title: z.string() });
  const articleModule: ModuleExports = { ArticleSchema, articlePopulate: {} };
  const zodModule: ModuleExports = { z };
  const queryString = compile(generateQueryStringCode(), () => ({}));
  const requestError = compile(generateRequestErrorCode(), () => ({}));
  const validationError = compile(generateErrorClassCode('zod'), (name) => {
    if (name === 'zod') return zodModule;
    throw new Error(`unexpected import ${name}`);
  });
  const modules: Record<string, ModuleExports> = {
    './query-string': queryString,
    './request-error': requestError,
    './schema-validation-error': validationError,
    '../content-types/article': articleModule,
    zod: zodModule,
  };
  const client = compile(generateClientCode([ARTICLE], new Set(), 'zod'), (name) => {
    const found = modules[name];
    if (!found) throw new Error(`unexpected import ${name}`);
    return found;
  });
  return {
    createStrapiClient: client.createStrapiClient as (config: Record<string, unknown>) => {
      articles: {
        findMany: (
          options?: Record<string, unknown>,
        ) => Promise<{ data: unknown[]; meta: unknown }>;
        findOne: (id: string, options?: Record<string, unknown>) => Promise<unknown>;
      };
    },
    StrapiRequestError: requestError.StrapiRequestError as new (...args: unknown[]) => Error,
    StrapiSchemaValidationError: validationError.StrapiSchemaValidationError as new (
      ...args: unknown[]
    ) => Error,
  };
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const LIST_BODY = {
  data: [{ documentId: 'a1', title: 'Hello' }],
  meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 } },
};

describe('generated client runtime', () => {
  const { createStrapiClient, StrapiRequestError, StrapiSchemaValidationError } = loadClient();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  const client = (config: Record<string, unknown> = {}) =>
    createStrapiClient({ baseUrl: 'http://cms', token: 'secret', fetch: fetchMock, ...config });

  it('sends the bearer token and the default populate, and returns data with pagination', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, LIST_BODY)));

    const result = await client().articles.findMany();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://cms/api/articles');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
    expect(result.data).toEqual(LIST_BODY.data);
    expect(result.meta).toEqual(LIST_BODY.meta);
  });

  it('keeps defaultParams when the call passes no per-request value for them', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, LIST_BODY)));

    await client({ defaultParams: { locale: 'en' } }).articles.findMany();
    await client({ defaultParams: { locale: 'en' } }).articles.findMany({ locale: 'de' });

    expect(fetchMock.mock.calls[0]?.[0]).toContain('locale=en');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('locale=de');
  });

  it('resolves a token provider per request', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, LIST_BODY)));
    const tokens = ['first', 'second'];
    const api = client({ token: () => tokens.shift() ?? 'none' });

    await api.articles.findMany();
    await api.articles.findMany();

    const auth = (index: number) =>
      new Headers((fetchMock.mock.calls[index] as [string, RequestInit])[1].headers).get(
        'Authorization',
      );
    expect(auth(0)).toBe('Bearer first');
    expect(auth(1)).toBe('Bearer second');
  });

  it('preserves a Headers instance from the request init and lets Authorization win', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, LIST_BODY)));
    const headers = new Headers({ 'X-Trace': 'abc', Authorization: 'Bearer forged' });

    await client().articles.findMany({ request: { headers } });

    const sent = new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(sent.get('X-Trace')).toBe('abc');
    expect(sent.get('Authorization')).toBe('Bearer secret');
    expect(sent.get('Content-Type')).toBe('application/json');
  });

  it('returns null for a 404 on a by-key lookup', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(404, { error: { message: 'Not Found' } })),
    );

    await expect(client().articles.findOne('missing')).resolves.toBeNull();
  });

  it('throws a StrapiRequestError carrying status, url and body for other failures', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(500, { error: { message: 'boom' } })),
    );

    const error = await client()
      .articles.findMany()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StrapiRequestError);
    expect(error).toMatchObject({ status: 500, url: 'http://cms/api/articles' });
    expect((error as { body: unknown }).body).toEqual({ error: { message: 'boom' } });
  });

  it('retries network failures with the configured attempts and then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, LIST_BODY)));

    const result = await client({ retry: { maxAttempts: 2, baseDelayMs: 0 } }).articles.findMany();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.data).toHaveLength(1);
  });

  it('does not retry by default', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(client().articles.findMany()).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a list response without meta.pagination', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { data: [] })));

    await expect(client().articles.findMany()).rejects.toThrow(/meta\.pagination/);
  });

  it('throws a StrapiSchemaValidationError when the payload does not match the schema', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ...LIST_BODY, data: [{ documentId: 'a1', title: 42 }] }),
    );

    const error = await client()
      .articles.findMany()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StrapiSchemaValidationError);
  });
});
