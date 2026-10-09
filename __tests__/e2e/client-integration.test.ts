import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';

import {
  login,
  getApiToken,
  getBaseUrl,
  uploadFile,
  createEntry,
  publishEntry,
  updateSingleType,
} from './helpers/api-client';
import { GENERATED_DIR } from './helpers/generated-dir';

type Client = Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;

let client: Client;
let createClient: (config: Record<string, unknown>) => Client;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids: Record<string, string> = {};
let imageId: number;

beforeAll(async () => {
  await login();
  const apiToken = getApiToken();

  const clientModule = await import(path.join(GENERATED_DIR, 'client', 'strapi-client.ts'));
  createClient = clientModule.createStrapiClient;
  client = createClient({ baseUrl: getBaseUrl(), token: apiToken });

  // Upload test image
  imageId = await uploadFile(`test-${suffix}.png`);

  // Author (full - email, richtext bio, media avatar)
  const author = await createEntry('api::author.author', {
    name: `Author ${suffix}`,
    email: `author-${suffix}@test.com`,
    bio: 'Author bio text',
    avatar: imageId,
  });
  ids.author = author.documentId;

  // Author-2 (minimal - null bio, null avatar)
  const author2 = await createEntry('api::author.author', {
    name: `Author2 ${suffix}`,
    email: `author2-${suffix}@test.com`,
  });
  ids.author2 = author2.documentId;

  // Category (media icon)
  const category = await createEntry('api::category.category', {
    name: `Category ${suffix}`,
    slug: `cat-${suffix}`,
    icon: imageId,
  });
  ids.category = category.documentId;

  // Category-2 (no icon - null optional media)
  const category2 = await createEntry('api::category.category', {
    name: `Category2 ${suffix}`,
    slug: `cat2-${suffix}`,
  });
  ids.category2 = category2.documentId;

  // Article (full - published, with relations + component + media)
  const article = await createEntry('api::article.article', {
    title: `Article ${suffix}`,
    slug: `art-${suffix}`,
    content: 'Full article body',
    excerpt: 'Short excerpt',
    publishDate: '2024-01-15',
    image: imageId,
    status: 'published',
    seo: {
      metaTitle: 'Article SEO',
      metaDescription: 'Article desc',
      metaImage: imageId,
      excludeFromSitemap: false,
    },
    categories: [ids.category],
    author: ids.author,
  });
  ids.article = article.documentId;
  await publishEntry('api::article.article', ids.article);

  // Article-draft (NOT published, missing required image)
  const articleDraft = await createEntry('api::article.article', {
    title: `Draft ${suffix}`,
    slug: `draft-${suffix}`,
    content: 'Draft content',
    status: 'draft',
  });
  ids.articleDraft = articleDraft.documentId;

  // Product (full - all scalar types + dynamic zones + components + relation)
  const product = await createEntry('api::product.product', {
    name: `Product ${suffix}`,
    sku: `SKU-${suffix}`,
    price: 49.99,
    compareAtPrice: 59.99,
    quantity: 100,
    isActive: true,
    totalViews: '12345678901234',
    metadata: { color: 'blue', weight: '500g' },
    images: [imageId],
    thumbnail: imageId,
    tags: [
      { name: 'Tag1', color: '#FF0000' },
      { name: 'Tag2', color: '#00FF00' },
    ],
    fulfillmentOptions: [
      {
        __component: 'catalog.one-time-option',
        sku: `OTO-${suffix}`,
        price: 49.99,
        fulfillmentMethod: 'shipped',
      },
      {
        __component: 'catalog.subscription-option',
        sku: `SUB-${suffix}`,
        recurringCost: 19.99,
        fulfillmentMethod: 'virtual',
        intervalDays: 30,
        initialDelayDays: 0,
      },
    ],
    productMetadata: [
      {
        __component: 'catalog.marketing-metadata',
        isMarketingMetadata: true,
        category: 'skincare',
      },
    ],
    category: ids.category,
  });
  ids.product = product.documentId;

  // Product-2 (minimal - edge cases: null optional fields, single dynamic zone variant)
  const product2 = await createEntry('api::product.product', {
    name: `Product2 ${suffix}`,
    sku: `SKU2-${suffix}`,
    price: 9.99,
    quantity: 0,
    isActive: false,
    images: [imageId],
    fulfillmentOptions: [
      {
        __component: 'catalog.one-time-option',
        sku: `OTO2-${suffix}`,
        price: 9.99,
        fulfillmentMethod: 'shipped',
      },
    ],
  });
  ids.product2 = product2.documentId;

  // Product variant (required relation to product - never populated by default)
  const variant = await createEntry('api::product-variant.product-variant', {
    variantName: `Variant ${suffix}`,
    sku: `VAR-${suffix}`,
    price: 24.99,
    fulfillmentOptions: [
      {
        __component: 'catalog.one-time-option',
        sku: `VAR-OTO-${suffix}`,
        price: 24.99,
        fulfillmentMethod: 'shipped',
      },
    ],
    product: ids.product,
  });
  ids.variant = variant.documentId;

  // Announcement (scalar-only single type - exercises empty populate + client)
  await updateSingleType('api::announcement.announcement', {
    title: `Announcement ${suffix}`,
    text: 'Scheduled maintenance tonight',
    isVisible: true,
  });
}, 30_000);

// --- Group 1: Happy path ---

describe('happy path - schema validation passes', () => {
  it('category findMany', async () => {
    const categories = (
      (await client.categories.findMany()) as { data: Array<Record<string, unknown>> }
    ).data;
    const cat = categories.find((c) => c.documentId === ids.category) as Record<string, unknown>;

    expect(cat).toBeDefined();
    expect(cat.name).toContain('Category');
  });

  it('category findOne by documentId', async () => {
    const cat = (await client.categories.findOne(ids.category)) as Record<string, unknown>;
    expect(cat.documentId).toBe(ids.category);
  });

  it('author with avatar media and RenderedHtml bio', async () => {
    const authors = ((await client.authors.findMany()) as { data: Array<Record<string, unknown>> })
      .data;
    const author = authors.find((a) => a.documentId === ids.author) as Record<string, unknown>;

    expect(author.email).toContain('@test.com');
    expect(author.avatar).toBeDefined();
    expect((author.avatar as Record<string, unknown>).url).toBeDefined();
  });

  it('product validates all scalar types', async () => {
    const products = (
      (await client.products.findMany()) as { data: Array<Record<string, unknown>> }
    ).data;
    const prod = products.find((p) => p.documentId === ids.product) as Record<string, unknown>;

    expect(prod.price).toBe(49.99);
    expect(prod.compareAtPrice).toBe(59.99);
    expect(prod.quantity).toBe(100);
    expect(prod.isActive).toBe(true);
    expect(prod.metadata).toEqual({ color: 'blue', weight: '500g' });
  });

  it('product with media array and thumbnail', async () => {
    const prod = (await client.products.findOne(ids.product)) as Record<string, unknown>;

    expect(Array.isArray(prod.images)).toBe(true);
    expect((prod.images as unknown[]).length).toBeGreaterThan(0);
    expect(prod.thumbnail).toBeDefined();
    expect((prod.thumbnail as Record<string, unknown>).url).toBeDefined();
  });

  it('article with published data and media', async () => {
    const articles = (
      (await client.articles.findMany()) as { data: Array<Record<string, unknown>> }
    ).data;
    const article = articles.find((a) => a.documentId === ids.article) as Record<string, unknown>;

    expect(article).toBeDefined();
    expect(article.title).toContain('Article');
    expect(article.image).toBeDefined();
    expect((article.image as Record<string, unknown>).url).toBeDefined();
  });
});

// --- Group 2: Dynamic zone validation ---

describe('dynamic zone validation', () => {
  it('product fulfillmentOptions has both variants', async () => {
    const prod = (await client.products.findOne(ids.product)) as Record<string, unknown>;
    const options = prod.fulfillmentOptions as Array<Record<string, unknown>>;

    expect(options).toHaveLength(2);
    expect(options.map((o) => o.__component)).toContain('catalog.one-time-option');
    expect(options.map((o) => o.__component)).toContain('catalog.subscription-option');
  });

  it('product with only one fulfillment variant passes', async () => {
    const prod = (await client.products.findOne(ids.product2)) as Record<string, unknown>;
    const options = prod.fulfillmentOptions as Array<Record<string, unknown>>;

    expect(options).toHaveLength(1);
    expect(options[0].__component).toBe('catalog.one-time-option');
  });

  it('product marketingMetadata dynamic zone', async () => {
    const prod = (await client.products.findOne(ids.product)) as Record<string, unknown>;
    const meta = prod.productMetadata as Array<Record<string, unknown>>;

    expect(meta).toHaveLength(1);
    expect(meta[0].__component).toBe('catalog.marketing-metadata');
    expect(meta[0].category).toBe('skincare');
  });
});

// --- Group 3: Nested component validation ---

describe('nested component validation', () => {
  it('article seo with nested metaImage', async () => {
    const articles = (
      (await client.articles.findMany()) as { data: Array<Record<string, unknown>> }
    ).data;
    const article = articles.find((a) => a.documentId === ids.article) as Record<string, unknown>;
    const seo = article.seo as Record<string, unknown>;

    expect(seo).toBeDefined();
    expect(seo.metaTitle).toBe('Article SEO');
    expect(seo.metaImage).toBeDefined();
    expect((seo.metaImage as Record<string, unknown>).url).toBeDefined();
  });

  it('product tags repeatable component', async () => {
    const prod = (await client.products.findOne(ids.product)) as Record<string, unknown>;
    const tags = prod.tags as Array<Record<string, unknown>>;

    expect(tags).toHaveLength(2);
    expect(tags[0].name).toBe('Tag1');
    expect(tags[0].color).toBe('#FF0000');
  });
});

// --- Group 4: Relation validation ---

describe('relation validation (relations excluded from populate)', () => {
  it('article author is not populated', async () => {
    const articles = (
      (await client.articles.findMany()) as { data: Array<Record<string, unknown>> }
    ).data;
    const article = articles.find((a) => a.documentId === ids.article) as Record<string, unknown>;

    expect(article.author).toBeUndefined();
  });

  it('article categories is not populated', async () => {
    const articles = (
      (await client.articles.findMany()) as { data: Array<Record<string, unknown>> }
    ).data;
    const article = articles.find((a) => a.documentId === ids.article) as Record<string, unknown>;

    expect(article.categories).toBeUndefined();
  });

  it('product category is not populated', async () => {
    const prod = (await client.products.findOne(ids.product)) as Record<string, unknown>;
    expect(prod.category).toBeUndefined();
  });
});

// --- Group 5: RenderedHtml richtext transform ---

describe('RenderedHtml richtext transform', () => {
  it('article content is RenderedHtml object', async () => {
    const articles = (
      (await client.articles.findMany()) as { data: Array<Record<string, unknown>> }
    ).data;
    const article = articles.find((a) => a.documentId === ids.article) as Record<string, unknown>;
    const content = article.content as Record<string, unknown>;

    expect(content).toBeDefined();
    expect(typeof content.html).toBe('string');
    expect(content.html).toBe('Full article body');
  });

  it('author bio is RenderedHtml object', async () => {
    const authors = ((await client.authors.findMany()) as { data: Array<Record<string, unknown>> })
      .data;
    const author = authors.find((a) => a.documentId === ids.author) as Record<string, unknown>;
    const bio = author.bio as Record<string, unknown>;

    expect(bio).toBeDefined();
    expect(bio.html).toBe('Author bio text');
  });

  it('null richtext stays null (author-2 has no bio)', async () => {
    const authors = ((await client.authors.findMany()) as { data: Array<Record<string, unknown>> })
      .data;
    const author2 = authors.find((a) => a.documentId === ids.author2) as Record<string, unknown>;

    expect(author2.bio).toBeNull();
  });
});

// --- Group 6: Query options ---

describe('query options', () => {
  it('findMany with filters returns exact match', async () => {
    const { data } = (await client.categories.findMany({
      filters: { documentId: { $eq: ids.category } },
    })) as { data: Array<Record<string, unknown>> };

    expect(data).toHaveLength(1);
    expect(data[0].documentId).toBe(ids.category);
  });

  it('findMany with pagination returns meta', async () => {
    const result = (await client.categories.findMany({
      pagination: { page: 1, pageSize: 1 },
    })) as { data: unknown[]; meta: { pagination: Record<string, number> } };

    expect(result.data).toHaveLength(1);
    expect(result.meta.pagination.page).toBe(1);
    expect(result.meta.pagination.pageSize).toBe(1);
    expect(result.meta.pagination.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.meta.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('findMany with sort', async () => {
    const { data } = (await client.categories.findMany({
      sort: 'name:asc',
    })) as { data: Array<{ name: string }> };

    expect(data.length).toBeGreaterThan(0);
  });

  it('defaultParams apply when the call passes no per-request option for them', async () => {
    const withDefaults = createClient({
      baseUrl: getBaseUrl(),
      token: getApiToken(),
      defaultParams: { pagination: { pageSize: 1 } },
    });

    const result = (await withDefaults.categories.findMany()) as {
      data: unknown[];
      meta: { pagination: Record<string, number> };
    };

    expect(result.data).toHaveLength(1);
    expect(result.meta.pagination.pageSize).toBe(1);
  });

  it('findMany empty results returns empty array', async () => {
    const { data } = (await client.products.findMany({
      filters: { name: { $eq: 'nonexistent-xyz' } },
    })) as { data: unknown[] };

    expect(data).toEqual([]);
  });
});

// --- Group 7: Error handling and validation failures ---

describe('error handling and validation failures', () => {
  it('findOne non-existent documentId resolves null (by-key lookup contract)', async () => {
    await expect(client.categories.findOne('non-existent-id')).resolves.toBeNull();
  });

  it('validation error on draft article with missing required image', async () => {
    try {
      await client.articles.findMany({ status: 'draft' });
    } catch (err: unknown) {
      const error = err as { name: string; endpoint: string; issueCount: number };
      expect(error.name).toBe('StrapiSchemaValidationError');
      expect(error.endpoint).toBe('articles');
      expect(error.issueCount).toBeGreaterThan(0);
      return;
    }
    throw new Error('Expected StrapiSchemaValidationError');
  });

  it('validation error message includes field path', async () => {
    try {
      await client.articles.findMany({ status: 'draft' });
    } catch (err: unknown) {
      expect((err as Error).message).toContain('image');
      return;
    }
    throw new Error('Expected validation error');
  });
});

// --- Group 8: Draft/publish ---

describe('draft/publish behavior', () => {
  it('published article visible without status param', async () => {
    const articles = (
      (await client.articles.findMany()) as { data: Array<Record<string, unknown>> }
    ).data;
    const found = articles.find((a) => a.documentId === ids.article);
    expect(found).toBeDefined();
  });

  it('draft article NOT visible without status param', async () => {
    const articles = (
      (await client.articles.findMany()) as { data: Array<Record<string, unknown>> }
    ).data;
    const found = articles.find((a) => a.documentId === ids.articleDraft);
    expect(found).toBeUndefined();
  });
});

// --- Group 9: Empty/null edge cases ---

describe('empty/null edge cases', () => {
  it('author-2 null avatar (optional media) passes', async () => {
    const authors = ((await client.authors.findMany()) as { data: Array<Record<string, unknown>> })
      .data;
    const author2 = authors.find((a) => a.documentId === ids.author2) as Record<string, unknown>;

    expect(author2).toBeDefined();
    expect(author2.avatar).toBeNull();
  });

  it('category-2 null icon (optional media) passes', async () => {
    const cat = (await client.categories.findOne(ids.category2)) as Record<string, unknown>;
    expect(cat.icon).toBeNull();
  });

  it('product-2 null metadata (json) passes', async () => {
    const prod = (await client.products.findOne(ids.product2)) as Record<string, unknown>;
    expect(prod.metadata).toBeNull();
  });

  it('product-2 category not populated (relation excluded)', async () => {
    const prod = (await client.products.findOne(ids.product2)) as Record<string, unknown>;
    expect(prod.category).toBeUndefined();
  });

  it('product-2 null thumbnail (optional media) passes', async () => {
    const prod = (await client.products.findOne(ids.product2)) as Record<string, unknown>;
    expect(prod.thumbnail).toBeNull();
  });

  it('product-2 no tags (empty repeatable) passes', async () => {
    const prod = (await client.products.findOne(ids.product2)) as Record<string, unknown>;
    expect(prod.tags === null || (Array.isArray(prod.tags) && prod.tags.length === 0)).toBe(true);
  });
});

// --- Group 10: Custom populate (deep relation) ---

describe('custom populate - extending default populate with relations', () => {
  it('deep populate with author relation passes validation', async () => {
    const { data: articles } = (await client.articles.findMany({
      populate: {
        image: true,
        seo: {
          populate: {
            metaImage: true,
            metaSocial: { populate: { image: true } },
          },
        },
        author: {
          populate: { avatar: true },
        },
      },
    })) as { data: Array<Record<string, unknown>> };

    const article = articles.find((a) => a.documentId === ids.article) as Record<string, unknown>;
    expect(article).toBeDefined();
    expect(article.author).toBeDefined();
    expect((article.author as Record<string, unknown>).name).toContain('Author');
    expect((article.author as Record<string, unknown>).avatar).toBeDefined();
  });

  it('shallow populate with relation fails validation (missing required media on related entity)', async () => {
    await expect(
      client.categories.findMany({
        populate: {
          icon: true,
          articles: true,
        },
      }),
    ).rejects.toThrow();
  });
});

// --- Group 11: Regression coverage for biginteger, required relations, scalar-only types ---

describe('biginteger fields', () => {
  it('round-trips beyond Number.MAX_SAFE_INTEGER as a string', async () => {
    const prod = (await client.products.findOne(ids.product)) as Record<string, unknown>;

    expect(typeof prod.totalViews).toBe('string');
    expect(prod.totalViews).toBe('12345678901234');
  });

  it('is null when not set', async () => {
    const prod = (await client.products.findOne(ids.product2)) as Record<string, unknown>;
    expect(prod.totalViews).toBeNull();
  });
});

describe('required relations', () => {
  it('pass validation with default populate (relation absent from response)', async () => {
    const { data: variants } = (await client.productVariants.findMany()) as {
      data: Array<Record<string, unknown>>;
    };
    const variant = variants.find((v) => v.documentId === ids.variant) as Record<string, unknown>;

    expect(variant).toBeDefined();
    expect(variant.variantName).toContain('Variant');
    // default populate never includes relations - nullish schema must accept that
    expect(variant.product).toBeUndefined();
  });
});

describe('scalar-only single type', () => {
  it('is served by the generated client with an empty default populate', async () => {
    const announcement = (await client.announcement.find()) as Record<string, unknown>;

    expect(announcement.title).toContain('Announcement');
    expect(announcement.isVisible).toBe(true);
  });
});
