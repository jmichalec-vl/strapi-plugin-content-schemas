import { describe, it, expect } from 'vitest';

import '../../../../server/src/mappers/valibot/index';
import '../../../../server/src/mappers/zod/index';
import {
  generateClientCode,
  generateErrorClassCode,
  generateRequestErrorCode,
  type ViewClientEntry,
} from '../../../../server/src/generators/client-generator';
import type { ContentTypeIR } from '../../../../server/src/types';

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

const PAGE: ContentTypeIR = {
  uid: 'api::page.page',
  singularName: 'page',
  pluralName: 'pages',
  displayName: 'Page',
  kind: 'collectionType',
  attributes: [
    { name: 'documentId', type: 'string', required: true },
    { name: 'title', type: 'string', required: true },
  ],
};

const HEADER: ContentTypeIR = {
  uid: 'api::header.header',
  singularName: 'header',
  pluralName: 'headers',
  displayName: 'Header',
  kind: 'singleType',
  attributes: [
    { name: 'documentId', type: 'string', required: true },
    { name: 'title', type: 'string', required: true },
  ],
};

describe('generateClientCode', () => {
  it('imports the inline serializer and valibot', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain("import { serializeQuery } from './query-string'");
    expect(code).not.toContain("from 'qs'");
    expect(code).toContain("from 'valibot'");
  });

  it('imports schema and type for each content type', () => {
    const code = generateClientCode([ARTICLE, PAGE], new Set());

    expect(code).toContain(
      "import { ArticleSchema, type Article } from '../content-types/article'",
    );
    expect(code).toContain("import { PageSchema, type Page } from '../content-types/page'");
  });

  it('imports populate for each content type', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain("import { articlePopulate } from '../content-types/article'");
  });

  it('imports error class', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain(
      "import { StrapiSchemaValidationError } from './schema-validation-error'",
    );
  });

  it('generates StrapiClientConfig interface', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('interface StrapiClientConfig');
    expect(code).toContain('baseUrl: string');
    expect(code).toContain('token: string');
  });

  it('generates StrapiClient interface with collection type methods', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('export interface StrapiClient');
    expect(code).toContain('articles:');
    expect(code).toContain('findMany:');
    expect(code).toContain('findOne:');
    expect(code).toContain('Promise<StrapiListResponse<Article>>');
    expect(code).toContain('Promise<Article | null>');
  });

  it('generates find method for single types under a singular accessor', () => {
    const code = generateClientCode([HEADER], new Set());

    // singular everywhere: accessor, endpoint, return type
    expect(code).toContain('readonly header: {');
    expect(code).not.toContain('readonly headers: {');
    expect(code).toContain('find:');
    expect(code).toContain('Promise<Header | null>');
    expect(code).not.toContain('findMany');
    expect(code).not.toContain('findOne');
  });

  it('generates createStrapiClient factory', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('export const createStrapiClient');
    expect(code).toContain('StrapiClient');
  });

  it('generates findMany with array wrapper', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain("requestList('articles', array(ArticleSchema), articlePopulate");
  });

  it('generates findOne with documentId param', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('`articles/${documentId}`');
    expect(code).toContain('ArticleSchema, articlePopulate');
  });

  it('generates find for single type', () => {
    const code = generateClientCode([HEADER], new Set());

    expect(code).toContain("request('header', HeaderSchema, headerPopulate");
  });

  it('generates a read-only client - no write methods', () => {
    const code = generateClientCode([ARTICLE, HEADER], new Set());

    // Writes are deliberately not generated: the client is a read-side tool;
    // content writes belong to the admin panel or domain endpoints
    expect(code).not.toContain('create:');
    expect(code).not.toContain('update:');
    expect(code).not.toContain('delete:');
    expect(code).not.toContain('CreateInput');
  });

  it('uses serializeQuery for query params', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('serializeQuery({');
  });

  it('uses safeParse for response validation', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('safeParse');
    expect(code).toContain('StrapiSchemaValidationError');
  });

  it('includes file header', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('Auto-generated by strapi-plugin-content-schemas');
  });

  it('handles multiple content types', () => {
    const code = generateClientCode([ARTICLE, PAGE], new Set());

    expect(code).toContain('articles:');
    expect(code).toContain('pages:');
  });

  it('uses camelCase pluralName for property names', () => {
    const blogPost: ContentTypeIR = {
      uid: 'api::blog-post.blog-post',
      singularName: 'blog-post',
      pluralName: 'blog-posts',
      displayName: 'Blog Post',
      kind: 'collectionType',
      attributes: [],
    };

    const code = generateClientCode([blogPost], new Set());
    expect(code).toContain('blogPosts:');
  });
});

describe('client hardening', () => {
  it('accepts a token provider and resolves it per request', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('readonly token: string | (() => string);');
    expect(code).toContain("typeof token === 'function' ? token() : token");
  });

  it('has configurable retry with linear backoff, off by default', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('retry?.maxAttempts ?? 1');
    expect(code).toContain('[429, 502, 503, 504]');
    expect(code).toContain('baseDelayMs * attempt');
    expect(code).toContain('isNetworkFailure');
  });

  it('throws StrapiRequestError with status/url/body instead of stringly errors', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain("import { StrapiRequestError } from './request-error';");
    expect(code).toContain('new StrapiRequestError({ status: response.status, url, body })');
    expect(code).not.toContain('Strapi request failed: ${response.status} ${response.statusText}');
  });

  it('returns null on 404 for by-key lookups; lists still throw', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('if (response.status === 404) return null;');
    expect(code).toContain('Lists never legitimately 404');
  });

  it('merges per-request RequestInit with Authorization winning', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('readonly request?: RequestInit;');
    expect(code).toContain('...request,');
    expect(code).toContain("headers.set('Authorization', `Bearer ${resolveToken()}`)");
  });

  it('normalizes request headers through the Headers API so Headers instances are not lost', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('const headers = new Headers(request?.headers);');
    expect(code).toContain(
      "if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');",
    );
    expect(code).not.toContain('...(request?.headers as Record<string, string> | undefined)');
  });

  it('supports defaultParams and an explicit locale option', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('readonly defaultParams?: Record<string, unknown>;');
    expect(code).toContain('...defaultParams,');
    expect(code).toContain('readonly locale?: string;');
    expect(code).toContain('locale: options?.locale,');
  });

  it('does not let absent per-request options shadow defaultParams', () => {
    const keyless: readonly ViewClientEntry[] = [
      { id: 'chrome', path: '/chrome', keyParam: null, schemaExport: null, typeExport: null },
    ];
    const code = generateClientCode([ARTICLE], new Set(), 'valibot', keyless);

    expect(code).toContain('const withoutUndefined = (params: Record<string, unknown>)');
    expect(code).toContain('...defaultParams,\n      ...withoutUndefined({\n        populate,');
    expect(code).toContain(
      '...defaultParams,\n      ...withoutUndefined({ status: options?.status, locale: options?.locale }),',
    );
  });

  it('names the retry defaults instead of inlining them', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).toContain('const DEFAULT_RETRY_BASE_DELAY_MS = 300;');
    expect(code).toContain(
      'const DEFAULT_RETRY_STATUSES: readonly number[] = [429, 502, 503, 504];',
    );
    expect(code).toContain('retry?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS');
  });
});

describe('generateRequestErrorCode', () => {
  it('emits the structured error class', () => {
    const code = generateRequestErrorCode();

    expect(code).toContain('export class StrapiRequestError extends Error');
    expect(code).toContain('public readonly status: number;');
    expect(code).toContain('public readonly body: unknown;');
  });
});

describe('views client', () => {
  const VIEW_ENTRIES: readonly ViewClientEntry[] = [
    {
      id: 'landing-page',
      path: '/landing-page/:slug',
      keyParam: 'slug',
      schemaExport: 'LandingPageResponseSchema',
      typeExport: 'LandingPageResponse',
    },
    {
      id: 'detail-page',
      path: '/detail-page/:sku',
      keyParam: 'sku',
      schemaExport: 'DetailPageAssembledSuccessSchema',
      typeExport: 'DetailPageAssembledSuccess',
    },
    {
      id: 'mystery-page',
      path: '/mystery-page/:key',
      keyParam: 'key',
      schemaExport: null,
      typeExport: null,
    },
  ];

  it('emits a views group with typed per-view methods', () => {
    const code = generateClientCode([ARTICLE], new Set(), 'valibot', VIEW_ENTRIES);

    expect(code).toContain(
      "import { LandingPageResponseSchema, type LandingPageResponse } from '../views/landing-page';",
    );
    expect(code).toContain('readonly views: {');
    expect(code).toContain(
      'readonly landingPage: (slug: string, options?: ViewRequestOptions) => Promise<LandingPageResponse | null>;',
    );
    expect(code).toContain(
      'readonly detailPage: (sku: string, options?: ViewRequestOptions) => Promise<DetailPageAssembledSuccess | null>;',
    );
  });

  it('encodes the key into the manifest path template', () => {
    const code = generateClientCode([ARTICLE], new Set(), 'valibot', VIEW_ENTRIES);

    expect(code).toContain(
      'viewRequest<LandingPageResponse>(`/landing-page/${encodeURIComponent(slug)}`, LandingPageResponseSchema, options)',
    );
    expect(code).toContain('${baseUrl}/api/bff-views${endpoint}');
  });

  it('emits undeclared assemble views as unknown with a nudge comment', () => {
    const code = generateClientCode([ARTICLE], new Set(), 'valibot', VIEW_ENTRIES);

    expect(code).toContain("Declare viewResponseSchemas['mystery-page'] for typed validation");
    expect(code).toContain(
      'readonly mysteryPage: (key: string, options?: ViewRequestOptions) => Promise<unknown | null>;',
    );
    expect(code).toContain(
      'viewRequest<unknown>(`/mystery-page/${encodeURIComponent(key)}`, null, options)',
    );
  });

  it('emits keyless view methods without a key argument', () => {
    const keyless: readonly ViewClientEntry[] = [
      {
        id: 'chrome',
        path: '/chrome',
        keyParam: null,
        schemaExport: 'ChromeResponseSchema',
        typeExport: 'ChromeResponse',
      },
    ];
    const code = generateClientCode([ARTICLE], new Set(), 'valibot', keyless);

    expect(code).toContain(
      'readonly chrome: (options?: ViewRequestOptions) => Promise<ChromeResponse | null>;',
    );
    expect(code).toContain(
      'chrome: (options?) => viewRequest<ChromeResponse>(`/chrome`, ChromeResponseSchema, options),',
    );
    expect(code).not.toContain('encodeURIComponent(undefined)');
  });

  it('escapes template-literal syntax in manifest paths', () => {
    const hostile: readonly ViewClientEntry[] = [
      {
        id: 'odd',
        path: '/odd/`${x}`/:key',
        keyParam: 'key',
        schemaExport: null,
        typeExport: null,
      },
    ];
    const code = generateClientCode([ARTICLE], new Set(), 'valibot', hostile);

    expect(code).toContain(
      'viewRequest<unknown>(`/odd/\\`\\${x}\\`/${encodeURIComponent(key)}`, null, options)',
    );
  });

  it('omits the views group entirely without entries', () => {
    const code = generateClientCode([ARTICLE], new Set());

    expect(code).not.toContain('readonly views:');
    expect(code).not.toContain('ViewRequestOptions');
  });
});

describe('generateErrorClassCode', () => {
  it('exports StrapiSchemaValidationError class', () => {
    const code = generateErrorClassCode();

    expect(code).toContain('export class StrapiSchemaValidationError extends Error');
  });

  it('imports from valibot', () => {
    const code = generateErrorClassCode();

    expect(code).toContain("from 'valibot'");
    expect(code).toContain('BaseIssue');
    expect(code).toContain('getDotPath');
  });

  it('has IDENTIFIER_FIELDS', () => {
    const code = generateErrorClassCode();

    expect(code).toContain('IDENTIFIER_FIELDS');
    expect(code).toContain('__component');
    expect(code).toContain('documentId');
  });

  it('has ErrorContext interface', () => {
    const code = generateErrorClassCode();

    expect(code).toContain('interface ErrorContext');
    expect(code).toContain('endpoint: string');
    expect(code).toContain('status: number');
    expect(code).toContain('issues:');
  });

  it('has formatting functions', () => {
    const code = generateErrorClassCode();

    expect(code).toContain('formatValidationError');
    expect(code).toContain('formatSingleIssue');
    expect(code).toContain('extractIdentifiers');
  });

  it('includes file header', () => {
    const code = generateErrorClassCode();

    expect(code).toContain('Auto-generated by strapi-plugin-content-schemas');
  });
});
