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
} from '../helpers/api-client';
import { ZOD_DIR } from '../helpers/generated-dir';

// The zod output is otherwise only string-matched - this suite executes the
// generated zod client against the live Strapi instance so the zod adapter's
// runtime wiring (safeParse result shape, error class, serializer) is covered.

type Client = Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;

let client: Client;
const suffix = `zod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await login();
  const apiToken = getApiToken();

  const clientModule = await import(path.join(ZOD_DIR, 'client', 'strapi-client.ts'));
  client = clientModule.createStrapiClient({ baseUrl: getBaseUrl(), token: apiToken });

  const imageId = await uploadFile(`test-${suffix}.png`);

  const category = await createEntry('api::category.category', {
    name: `Category ${suffix}`,
    slug: `cat-${suffix}`,
    icon: imageId,
  });
  ids.category = category.documentId;

  const product = await createEntry('api::product.product', {
    name: `Product ${suffix}`,
    sku: `SKU-${suffix}`,
    price: 42.5,
    quantity: 10,
    isActive: true,
    totalViews: '987654321',
    images: [imageId],
    thumbnail: imageId,
    fulfillmentOptions: [
      {
        __component: 'catalog.one-time-option',
        sku: `OTO-${suffix}`,
        price: 42.5,
        fulfillmentMethod: 'shipped',
      },
    ],
  });
  ids.product = product.documentId;

  // Article linked to our category, image NOT populated later → the
  // validation-failure test below is self-sufficient regardless of file order
  const article = await createEntry('api::article.article', {
    title: `Article ${suffix}`,
    slug: `art-${suffix}`,
    content: 'Zod article body',
    publishDate: '2024-02-01',
    image: imageId,
    status: 'published',
    categories: [ids.category],
  });
  ids.article = article.documentId;
  await publishEntry('api::article.article', ids.article);

  await updateSingleType('api::announcement.announcement', {
    title: `Announcement ${suffix}`,
    text: 'Zod runtime announcement',
    isVisible: true,
  });
});

describe('zod client - happy path', () => {
  it('findMany validates and returns data + pagination', async () => {
    const { data, meta } = (await client.categories.findMany()) as {
      data: Array<Record<string, unknown>>;
      meta: { pagination: Record<string, number> };
    };

    expect(Array.isArray(data)).toBe(true);
    expect(meta.pagination.total).toBeGreaterThan(0);
    const category = data.find((c) => c.documentId === ids.category);
    expect(category).toBeDefined();
  });

  it('findOne validates a full product incl. biginteger as string', async () => {
    const product = (await client.products.findOne(ids.product)) as Record<string, unknown>;

    expect(product.name).toContain('Product');
    expect(typeof product.totalViews).toBe('string');
  });

  it('single type is served via singularName endpoint', async () => {
    const announcement = (await client.announcement.find()) as Record<string, unknown>;
    expect(announcement.title).toContain('Announcement');
  });
});

describe('zod client - validation failure', () => {
  it('rejects with StrapiSchemaValidationError when required fields are missing', async () => {
    // Populating category.articles pulls in articles without their required
    // media populated - the zod schema must reject that shape
    await expect(
      client.categories.findMany({
        populate: { icon: true, articles: true },
      }),
    ).rejects.toMatchObject({ name: 'StrapiSchemaValidationError' });
  });
});
