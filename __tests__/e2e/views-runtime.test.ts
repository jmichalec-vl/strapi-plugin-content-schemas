import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  login,
  getApiToken,
  getBaseUrl,
  uploadFile,
  createEntry,
  publishEntry,
  updateSingleType,
} from './helpers/api-client';
import { VALIBOT_DIR } from './helpers/generated-dir';

// Runtime contract tests: live bff-views responses parsed by the GENERATED
// schemas. This pins the cross-plugin behavioral contract inside this repo's
// own suite - the response envelope, the transformer walk (transforms apply in
// the core document, never below relations), and the declared assemble shape -
// instead of leaving it to downstream consumers' parity harnesses.

type Parser = { safeParse: (schema: unknown, data: unknown) => { success: boolean } };

const suffix = `views-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let token: string;
let valibot: Parser;
let articleSchemas: Record<string, unknown>;
let productSchemas: Record<string, unknown>;
let chromeSchemas: Record<string, unknown>;
let productSku: string;
let articleSlug: string;

const bffGet = async (route: string): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(`${getBaseUrl()}/api/bff-views${route}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
};

const expectParses = (schema: unknown, data: unknown): void => {
  const result = valibot.safeParse(schema, data) as {
    success: boolean;
    issues?: readonly unknown[];
  };
  expect(result.issues ?? []).toEqual([]);
  expect(result.success).toBe(true);
};

beforeAll(async () => {
  await login();
  token = getApiToken();
  // valibot is installed in the fixture app, not at the plugin root - resolve
  // it from where the generated files live, exactly as they do
  const requireFromGenerated = createRequire(path.join(VALIBOT_DIR, 'views', 'article-view.ts'));
  valibot = requireFromGenerated('valibot') as Parser;
  articleSchemas = await import(path.join(VALIBOT_DIR, 'views', 'article-view.ts'));
  productSchemas = await import(path.join(VALIBOT_DIR, 'views', 'product-view.ts'));
  chromeSchemas = await import(path.join(VALIBOT_DIR, 'views', 'chrome.ts'));

  const imageId = await uploadFile(`views-${suffix}.png`);

  productSku = `VSKU-${suffix}`;
  await createEntry('api::product.product', {
    name: `Views Product ${suffix}`,
    sku: productSku,
    price: 19.99,
    quantity: 3,
    isActive: true,
    images: [imageId],
    fulfillmentOptions: [
      {
        __component: 'catalog.one-time-option',
        sku: `VOTO-${suffix}`,
        price: 19.99,
        fulfillmentMethod: 'shipped',
      },
    ],
  });

  articleSlug = `views-art-${suffix}`;
  const article = await createEntry('api::article.article', {
    title: `Views Article ${suffix}`,
    slug: articleSlug,
    content: 'Raw richtext the bff transformer must compile',
    publishDate: '2024-03-01',
    image: imageId,
    status: 'published',
    seo: {
      metaTitle: 'Views Article SEO',
      metaDescription: 'Views desc',
      metaImage: imageId,
      excludeFromSitemap: false,
    },
  });
  await publishEntry('api::article.article', article.documentId);
}, 30_000);

describe('bff runtime contract - hook-free view (article-view)', () => {
  it('live response parses with the generated exact response schema', async () => {
    const { status, body } = await bffGet(`/article-view/${articleSlug}`);

    expect(status).toBe(200);
    // envelope + transformer semantics in one gate: meta.view literal, and the
    // richtext inside the core document transformed to the override shape
    expectParses(articleSchemas.ArticleViewResponseSchema, body);
  });
});

describe('generated views client (strapi.views.*)', () => {
  type ViewsClient = {
    views: Record<string, (key: string, options?: unknown) => Promise<unknown>>;
  };
  let strapi: ViewsClient;

  beforeAll(async () => {
    const clientModule = await import(path.join(VALIBOT_DIR, 'client', 'strapi-client.ts'));
    strapi = clientModule.createStrapiClient({
      baseUrl: getBaseUrl(),
      token: () => token, // token provider form
      retry: { maxAttempts: 2, baseDelayMs: 50 },
    }) as ViewsClient;
  });

  it('fetches and validates a hook-free view through the client', async () => {
    const envelope = (await strapi.views.articleView(articleSlug)) as {
      data: Record<string, unknown>;
      meta: { view: string };
    };

    expect(envelope.meta.view).toBe('article-view');
    expect(envelope.data.title).toContain('Views Article');
    // transformed richtext arrived in the override shape
    expect((envelope.data.content as Record<string, unknown>).html).toContain('Raw richtext');
  });

  it('fetches the declared assemble view through the client', async () => {
    const envelope = (await strapi.views.productView(productSku)) as {
      data: { product: Record<string, unknown> };
    };

    expect(envelope.data.product.sku).toBe(productSku);
  });

  it('resolves null for unknown keys', async () => {
    await expect(strapi.views.productView(`missing-${suffix}`)).resolves.toBeNull();
  });

  it('fetches a keyless singleton view (no key argument)', async () => {
    await updateSingleType('api::announcement.announcement', {
      title: `Chrome Announcement ${suffix}`,
      text: 'Keyless singleton runtime check',
      isVisible: true,
    });

    const keyless = strapi.views as unknown as Record<
      string,
      (options?: unknown) => Promise<unknown>
    >;
    const envelope = (await keyless.announcementView!()) as {
      data: Record<string, unknown>;
      meta: { view: string };
    };

    expect(envelope.meta.view).toBe('announcement-view');
    expect(envelope.data.title).toContain('Chrome Announcement');
  });

  it('fetches a composite view: nullable single-doc source + many source', async () => {
    const keyless = strapi.views as unknown as Record<
      string,
      (options?: unknown) => Promise<unknown>
    >;
    const envelope = (await keyless.chrome!()) as {
      data: {
        announcement: Record<string, unknown> | null;
        categories: Array<Record<string, unknown>>;
      };
      meta: { view: string };
    };

    expect(envelope.meta.view).toBe('chrome');
    expect(envelope.data.announcement?.title).toContain('Chrome Announcement');
    expect(Array.isArray(envelope.data.categories)).toBe(true);
    // the generated schema now promises id at every entity level - parsing the
    // live envelope proves the runtime delivers it for both source kinds
    expectParses(chromeSchemas.ChromeResponseSchema, envelope);
  });
});

describe('bff runtime contract - assemble view (product-view)', () => {
  it('live response parses with the declared Success schema', async () => {
    const { status, body } = await bffGet(`/product-view/${productSku}`);

    expect(status).toBe(200);
    expectParses(productSchemas.ProductViewAssembledSuccessSchema, body);
  });

  it('error responses parse with the generated envelope (Result union)', async () => {
    const { status, body } = await bffGet(`/product-view/does-not-exist-${suffix}`);

    expect(status).toBeGreaterThanOrEqual(400);
    expectParses(productSchemas.ProductViewAssembledResultSchema, body);
  });
});
