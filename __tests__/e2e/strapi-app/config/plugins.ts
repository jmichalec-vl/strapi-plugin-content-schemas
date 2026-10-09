import path from 'node:path';

// This plugin is loaded from the repository root (source or compiled config)
const depth = __dirname.includes(path.join('dist', 'config')) ? 5 : 4;
const steps = Array.from({ length: depth }, () => '..');
const pluginRoot = path.resolve(__dirname, ...steps);

// bff-views comes from npm (a dependency of this app). Set BFF_VIEWS_ROOT to
// a local checkout to run the e2e suite against unpublished changes.
const bffViewsRoot = process.env.BFF_VIEWS_ROOT;

export default () => ({
  // Exercises the optional per-view schema generation: when bff-views is
  // enabled in the same app, the generated output additionally contains views/*.
  'bff-views': {
    enabled: true,
    ...(bffViewsRoot ? { resolve: bffViewsRoot } : {}),
    config: {
      transformers: {
        'compile-richtext': {
          match: { fieldType: 'richtext' },
          transform: (value: unknown) => ({
            html: String(value),
            meta: {},
          }),
        },
      },
      views: {
        'page-view': {
          contentType: 'api::page.page',
          path: '/page-view/:slug',
          lookup: { field: 'slug' },
          planner: {
            fields: ['title', 'slug'],
            componentFields: ['seo'],
            dynamicZones: ['modules'],
            // Exercises override narrowing: the generator interprets this
            // Document-Service populate and emits an exact view-local slice
            components: {
              'modules.product-grid': {
                populate: {
                  products: { fields: ['name', 'sku'], populate: { thumbnail: true } },
                  promoTiles: true,
                },
              },
            },
          },
          transforms: ['compile-richtext'],
        },
        // Cycle-free hook-free view: the runtime contract e2e seeds an article
        // and validates the live response against the generated exact schema
        // (page creation is blocked by a Strapi-core recursion on the
        // deliberately self-referencing faq-item component)
        'article-view': {
          contentType: 'api::article.article',
          path: '/article-view/:slug',
          lookup: { field: 'slug' },
          planner: {
            fields: ['title', 'slug', 'content'],
            componentFields: ['seo'],
            mediaFields: ['image'],
          },
          transforms: ['compile-richtext'],
        },
        // Keyless views (bff-views 0.2.0): a singleton over the scalar-only
        // single type, and a composite chrome (single-doc + many sources)
        'announcement-view': {
          contentType: 'api::announcement.announcement',
          path: '/announcement-view',
          planner: {
            fields: ['title', 'text', 'isVisible'],
          },
        },
        chrome: {
          path: '/chrome',
          sources: {
            announcement: {
              contentType: 'api::announcement.announcement',
              planner: { fields: ['title', 'isVisible'] },
            },
            categories: {
              contentType: 'api::category.category',
              many: true,
              planner: { fields: ['name'], mediaFields: ['icon'] },
            },
          },
        },
        'product-view': {
          contentType: 'api::product.product',
          path: '/product-view/:sku',
          lookup: { field: 'sku' },
          planner: {
            fields: ['name', 'sku', 'price'],
            dynamicZones: ['fulfillmentOptions'],
            mediaFields: ['images', 'thumbnail'],
            relations: {
              // updatedAt: timestamp fields are IR-excluded but valid populate
              // selections the runtime returns
              variants: { fields: ['variantName', 'sku', 'price', 'updatedAt'] },
            },
          },
          assemble: async (merged: unknown) => ({ product: merged }),
        },
      },
    },
  },
  'content-schemas': {
    enabled: true,
    resolve: pluginRoot,
    config: {
      contentTypes: ['api::*'],
      components: 'referenced',
      includeInternalFields: { timestamps: false },
      typeOverrides: {
        valibot: {
          richtext: {
            schema: `object({ html: string(), meta: any() })`,
            name: 'RenderedHtmlSchema',
            typeName: 'RenderedHtml',
          },
        },
        zod: {
          richtext: {
            schema: `z.object({ html: z.string(), meta: z.unknown() })`,
            name: 'RenderedHtmlSchema',
            typeName: 'RenderedHtml',
          },
        },
      },
      fieldOverrides: {},
      // Declares the shape produced by product-view's assemble hook
      // ((merged) => ({ product: merged })) - co-located with the hook config
      viewResponseSchemas: {
        valibot: {
          'product-view': {
            schema: `object({ product: ProductViewMergedSchema })`,
            name: 'ProductViewAssembledSchema',
            typeName: 'ProductViewAssembled',
          },
        },
        zod: {
          'product-view': {
            schema: `z.object({ product: ProductViewMergedSchema })`,
            name: 'ProductViewAssembledSchema',
            typeName: 'ProductViewAssembled',
          },
        },
      },
    },
  },
});
