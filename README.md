# strapi-plugin-content-schemas

> Auto-generate [Valibot](https://valibot.dev) or [Zod](https://zod.dev) validation schemas, TypeScript interfaces, deep populate configs, a fully typed REST client, and Faker mock factories - straight from your Strapi v5 content types.

Every Strapi + TypeScript frontend ends up hand-writing validation schemas that mirror the content model. They drift, they break silently, and nobody notices until production. This plugin makes the running Strapi instance the single source of truth: it reads the content-type registry and serves ready-to-commit TypeScript code to your frontend via one endpoint and a small CLI.

```bash
npx strapi-schemas pull --url https://cms.example.com --token $STRAPI_TOKEN --output ./src/lib/strapi
```

## Features

- **Two schema targets** - Valibot (`--target valibot`, default) or Zod (`--target zod`)
- **Full attribute coverage** - scalars, enums, media, components, dynamic zones, relations, `biginteger` (as string, matching Strapi's JSON serialization), `json`/`blocks` (as `unknown`)
- **TypeScript interfaces** alongside every schema, with optional JSDoc (`@unique`, `@default`, relation/media/component annotations)
- **Discriminated unions for dynamic zones** - `variant('__component', ...)` / `z.discriminatedUnion(...)` for type-safe narrowing
- **Modern enums** - every enumeration gets a same-named `as const` object + literal-union type (`ArticleStatus.Draft`), with raw REST values and no TS `enum`; Strapi's `enumName` hint is honored for naming
- **Deep populate configs** - ready-made `populate` objects (with dynamic-zone `on:` syntax) that fetch everything your schemas expect
- **Typed REST client (read-only by design)** - `createStrapiClient()` with per-content-type `findMany`/`findOne`/`find` methods that validate every response at runtime; zero runtime dependencies (no `qs`, no schema lib on the client itself beyond your chosen target). Content writes belong to the admin panel or your own domain endpoints, so the client deliberately generates no write methods
- **Production-hardened client runtime** - structured `StrapiRequestError` (status/url/body), opt-in retry with linear backoff, `404 → null` on by-key lookups, per-request `RequestInit` passthrough (AbortSignal, Next.js `next`/`cache`), token providers (`() => string`), client-level `defaultParams`, explicit `locale`
- **Generated BFF view methods** - with bff-views present, `strapi.views.contentPage(slug)` fetches and validates view responses using the generated per-view schemas (declared assemble schemas included); keyless views (bff-views 0.2.0 singletons and composites) get key-free methods like `strapi.views.chrome()`, with composite schemas emitted as an object of per-source shapes; no hand-written view fetchers
- **Faker mock factories** (`--mocks`) - `mockArticle()`, `mockUploadFile()` etc. for tests
- **Custom type overrides** - map any Strapi type (or a single field) to your own schema, e.g. when middleware transforms `richtext` into a custom shape
- **Circular references handled** - lazy registry refs across content types, `lazy()` wrapping for component cycles
- **CI freshness check** - `strapi-schemas check` exits non-zero when committed schemas are stale
- **Watch mode** - polls a content hash and re-pulls automatically during development

## How it works

```
Strapi v5 (plugin)                          Frontend repo (CLI)
┌────────────────────────────┐              ┌─────────────────────────────┐
│ content-type registry      │              │ npx strapi-schemas pull     │
│   → IR → mappers →         │  tar.gz over │   → extracts .ts files      │
│   generators → tar.gz      │──HTTP+token─▶│   → prunes removed files    │
│                            │              │   → (optional) prettier     │
│ GET /api/content-schemas/  │              │                             │
│   schemas | manifest       │◀──hash poll──│ npx strapi-schemas check    │
└────────────────────────────┘              └─────────────────────────────┘
```

Generation is on-demand and cached server-side (keyed on a sha256 of the content model + plugin config), so pulls are cheap. Nothing is written to disk on the Strapi side.

## Requirements

- Strapi **v5** (`@strapi/strapi ^5.0.0`)
- Node.js **20 - 24**
- Frontend: `valibot` or `zod` installed in the consuming project (the generated code imports it); `@faker-js/faker` if you use `--mocks`

## Installation

In your Strapi project:

```bash
npm install strapi-plugin-content-schemas
```

Enable it in `config/plugins.ts`:

```ts
export default () => ({
  'content-schemas': {
    enabled: true,
  },
});
```

### Create an API token

The plugin exposes two `content-api` routes. Create an API token in the Strapi admin (**Settings → API Tokens**) and grant it the **Content Schemas** permissions (`getSchemas`, `getManifest`).

> ⚠️ **Never grant these permissions to the Public role.** The generated output includes your content model and any override schema code verbatim.

## Plugin configuration

All options are optional - the defaults generate schemas for every `api::*` content type.

```ts
// config/plugins.ts
export default () => ({
  'content-schemas': {
    enabled: true,
    config: {
      // Which content types to include (UID glob patterns)
      contentTypes: ['api::*'],

      // Components: 'referenced' (only those reachable from included content
      // types), 'all', or an explicit list of UID patterns
      components: 'referenced',

      // Include createdAt/updatedAt/publishedAt in generated schemas
      includeInternalFields: { timestamps: false },

      // Replace the default mapping for a Strapi attribute type, per target.
      // The schema string is emitted verbatim into shared/overrides.ts.
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

      // Replace the mapping for one specific field:
      // '<uid>.<fieldName>' → override (same shape as above, wins over typeOverrides)
      fieldOverrides: {},

      // A `media` typeOverride aligns generated schemas with a trimmed runtime
      // media shape (e.g. bff-views' mediaPopulate). Applies to media in
      // content-type/component schemas; multiple media is array-wrapped
      // automatically. View `mediaFields` (served full at runtime) keep the
      // full UploadFileSchema.
      // typeOverrides: { valibot: { media: { schema: `object({ url: string(), … })`, name: 'MediaFieldSchema', typeName: 'MediaField' } } },

      // Rename a component's generated identifiers when the default
      // category-prefixed name collides with a content type:
      // nameOverrides: { 'catalog.form': 'CatalogFormComponent' },
    },
  },
});
```

> **Overrides are yours, not the plugin's.** The plugin has no built-in
> knowledge of any particular override - `typeOverrides` and `fieldOverrides`
> are consumer-defined schema code emitted **verbatim** into
> `shared/overrides.ts`. `RenderedHtmlSchema` above is only an illustration of
> the mechanism: any name and schema work, and you need one exactly when your
> own middleware or BFF transforms a field into a shape the content model
> doesn't describe. Because override code lands unmodified in every consumer's
> generated output, treat the plugin config as a trusted input surface (see the
> API-token warning under [Installation](#create-an-api-token)).

| Option                             | Default        | Description                                                                                                                                                                                                                                              |
| ---------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentTypes`                     | `['api::*']`   | UID patterns of content types to generate                                                                                                                                                                                                                |
| `components`                       | `'referenced'` | `'referenced'`, `'all'`, or UID pattern array                                                                                                                                                                                                            |
| `includeInternalFields.timestamps` | `false`        | Include `createdAt`/`updatedAt`/`publishedAt`                                                                                                                                                                                                            |
| `typeOverrides`                    | `{}`           | Per-target map: Strapi type → custom schema                                                                                                                                                                                                              |
| `fieldOverrides`                   | `{}`           | Per-target map: `uid.field` → custom schema                                                                                                                                                                                                              |
| `viewTransformSchemas`             | `{}`           | Per-target map: bff-views transformer name → schema for its output (only for transforms not covered by a `typeOverride`)                                                                                                                                 |
| `viewResponseSchemas`              | `{}`           | Per-target map: bff-views view id → declared response schema for its `assemble` output (emitted verbatim with Success/Result envelope wrappers; referenced generated exports are auto-imported)                                                          |
| `nameOverrides`                    | `{}`           | Component uid → PascalCase identifier base, replacing the default category-prefixed name in every generated identifier. The escape hatch when a content type collides with a prefixed component name (e.g. `{ 'catalog.form': 'CatalogFormComponent' }`) |

Generation _options_ (target, nullable style, populate/client/jsdoc/mocks) are **not** server config - the CLI passes them as query parameters, so different consumers can pull different flavors from the same instance.

## CLI usage

The CLI ships with the plugin package. In your frontend repo:

```bash
npm install --save-dev strapi-plugin-content-schemas
```

```
Usage: strapi-schemas <command> [options]

Commands:
  pull    Pull schemas from a Strapi instance
  check   Check if committed schemas are up to date
  hash    Print the output hash for the current CMS state (writes nothing)

Required (or set in content-schemas.config.ts):
  --url <url>              Strapi instance URL (e.g., http://localhost:1337)
  --token <token>          API token (or set STRAPI_SCHEMAS_TOKEN)
  --output <dir>           Output directory for generated schemas (not used by hash)

Generation options:
  --target <target>        Schema target: valibot | zod (default: valibot)
  --nullable-style <style> nullish | optional-union-null (default: nullish)
  --no-populate            Disable populate generation
  --no-client              Disable client generation
  --jsdoc / --no-jsdoc     JSDoc comments on generated interfaces
  --mocks / --no-mocks     Faker.js mock factory functions
  --prettier / --no-prettier
                           Format output with the project's prettier
  --watch                  Watch for schema changes and re-pull
  --watch-interval <ms>    Polling interval in ms (default: 3000)

Flags may also be written as --flag=value. Flags win over config-file values.

Exit codes:
  0  success / schemas up to date
  1  check: committed schemas are stale
  2  the command itself failed
```

`--output` must be a dedicated directory: `pull` prunes generated files inside it, so the project root is refused. `--prettier` uses the prettier installed in your project (resolved from the working directory) and skips formatting with a warning when there is none.

`pull` also **prunes** files that were generated previously but no longer exist on the server (only files carrying the generated-file marker are ever deleted - your own files are safe).

### Idempotent writes and the output hash

`pull` writes only files whose bytes actually changed - a pull against an unchanged CMS performs **zero writes** (every mtime survives), and a model tweak rewrites only the affected files, so a dev server watching the output dir sees the minimal set of events. This holds with `--prettier` too: formatting runs in a hidden staging directory next to the output dir (where your repo's prettier config still resolves) and only the final result is compared.

Every pull prints and records the **output hash** - sha256 over the canonical generated output, before formatting, so CI and dev machines compute the same value regardless of prettier version or config. It lands in `.strapi-schemas-meta.json` in the output dir:

```json
{ "hash": "…", "target": "valibot", "files": ["…"], "cliVersion": "…" }
```

Scripts that only need the hash (publish-or-skip decisions, status lines) run `strapi-schemas hash` with the same generation flags as their `pull` - it prints the bare hash to stdout and touches nothing.

### Config file

Instead of repeating flags, drop a `content-schemas.config.ts` (or `.js` / `.mjs`) in your project root:

```ts
import { defineConfig } from 'strapi-plugin-content-schemas/config';

export default defineConfig({
  url: 'http://localhost:1337',
  output: './src/lib/strapi/generated',
  target: 'valibot',
  jsdoc: true,
  prettier: true,
});
```

CLI flags always win over config-file values; the `--no-*` forms switch off a toggle the config enables. The token is never read from the config file: pass `--token`, or set `STRAPI_SCHEMAS_TOKEN` in the environment so it stays out of shell history and process listings. The CLI warns when the URL is plain `http://` to a remote host.

### Recommended package scripts

```jsonc
{
  "scripts": {
    "schemas:pull": "strapi-schemas pull --token $STRAPI_TOKEN",
    "schemas:check": "strapi-schemas check --token $STRAPI_TOKEN",
  },
}
```

Run `schemas:check` in CI - it pulls to a temp directory, diffs against your committed output, prints added/removed/modified files, and exits `1` when stale (`2` when the check itself could not run, e.g. the server is unreachable). `.strapi-schemas-meta.json` is excluded from the comparison, so a CLI upgrade alone never reports drift.

## Generated output

```
generated/
├── index.ts                      # barrel: all schemas, types, populates, client
├── content-types/
│   ├── registry.ts               # lazy ref() registry (circular relations)
│   ├── article.ts                # ArticleSchema + Article + articlePopulate (+ types)
│   └── ...
├── components/<category>/<name>.ts
├── shared/
│   ├── upload-file.ts            # UploadFileSchema (full Strapi v5 media shape)
│   └── overrides.ts              # your typeOverrides / fieldOverrides
├── client/
│   ├── strapi-client.ts          # createStrapiClient()
│   ├── query-string.ts           # inline Strapi bracket-syntax serializer
│   └── schema-validation-error.ts
├── views/                        # only when strapi-plugin-bff-views is enabled
│   ├── index.ts                  # barrel
│   ├── <view-id>.ts              # <ViewId>ResponseSchema (exact) or <ViewId>MergedSchema (assemble views)
│   ├── envelope.ts               # BffErrorEnvelopeSchema (404/500 shape)
│   └── manifest.json             # the view manifest the schemas were derived from
└── mocks/                        # with --mocks
    ├── index.ts
    ├── article.mock.ts
    └── components/...
```

Component identifiers are category-prefixed (`shared.seo` → `SharedSeoSchema` / `SharedSeo` / `sharedSeoPopulate`) to prevent collisions with content types and with same-named components in other categories; file paths keep the plain component name inside its category folder.

A real example (`content-types/article.ts`, valibot, `--jsdoc`):

```ts
/* Auto-generated by strapi-plugin-content-schemas. Do not edit. */
import { array, nullish, object, picklist, string } from 'valibot';
import { ref, register } from './registry';
import { UploadFileSchema, type UploadFile } from '../shared/upload-file';
import { RenderedHtmlSchema, type RenderedHtml } from '../shared/overrides';
import { SharedSeoSchema, sharedSeoPopulate, type SharedSeo } from '../components/shared/seo';

// Modern enum pattern: raw wire values, autocompleted references, no TS `enum`
export const ArticleStatus = {
  Draft: 'draft',
  InReview: 'in_review',
  Published: 'published',
  Archived: 'archived',
} as const;
export type ArticleStatus = (typeof ArticleStatus)[keyof typeof ArticleStatus];

export const ArticleSchema = object({
  documentId: string(),
  title: string(),
  slug: string(),
  content: RenderedHtmlSchema, // ← typeOverride: richtext → RenderedHtml
  excerpt: nullish(string()),
  image: UploadFileSchema,
  status: picklist(['draft', 'in_review', 'published', 'archived']),
  seo: nullish(SharedSeoSchema),
  categories: nullish(array(ref('Category'))), // ← lazy cross-type ref
  author: nullish(ref('Author')),
});

register('Article', ArticleSchema);

export interface Article {
  readonly documentId: string;
  readonly title: string;
  /** @unique */
  readonly slug: string;
  readonly content: RenderedHtml;
  readonly excerpt?: string | null;
  /** Media (images) */
  readonly image: UploadFile;
  /** @default "draft" */
  readonly status: ArticleStatus;
  /** Component: shared.seo */
  readonly seo?: SharedSeo | null;
  /** Relation: manyToMany → api::category.category */
  readonly categories?: Category[] | null;
  /** Relation: manyToOne → api::author.author */
  readonly author?: Author | null;
}

export const articlePopulate = {
  image: true,
  seo: sharedSeoPopulate,
};
```

## Per-view schemas (bff-views integration)

When [`strapi-plugin-bff-views`](https://www.npmjs.com/package/strapi-plugin-bff-views) is enabled in the same Strapi app, generation additionally emits `views/*` - one schema file per configured BFF view, derived from that plugin's view manifest (feature-detected at generation time; neither plugin depends on the other, and this section is a no-op without it):

- Views **without** an `assemble` hook get an exact `<ViewId>ResponseSchema` - scalar subset, dynamic zones restricted to the zone's members, relations shaped exactly like the configured overlays.
- Views **with** an `assemble` hook get `<ViewId>MergedSchema` (the pre-hook document) to compose your own response schema from - or better, declare the assembled shape via `viewResponseSchemas` (below) and the generator emits it for you.
- Views with an `enrich` hook produce a loose object (unknown extra keys pass).
- `views/manifest.json` records the exact view configuration the schemas were derived from - commit it; `strapi-schemas check` then fails CI whenever a view config changes until schemas are re-pulled.

BFF transformers that change a field's type need a schema mapping:

- Transformers matching by **field type** are already covered if you have a `typeOverrides` entry for that type (e.g. `richtext` → `RenderedHtmlSchema`) - nothing extra to configure.
- Anything else needs a `viewTransformSchemas` entry keyed by transformer name (same `{ schema, name, typeName }` shape, per target).
- A transform the generator cannot map **degrades to `unknown()` with a warning** (in the file header and in `manifest.json`) - never a silently-wrong schema. The same applies to dynamic zones narrowed by `planner.components` overrides.

### Declared response schemas for assemble views (`viewResponseSchemas`)

An `assemble` hook defines the final response shape in arbitrary JS the generator cannot derive. Instead of hand-writing that schema in the consumer repo, declare it in config - co-located with the hook, keyed by view id (per target):

```ts
viewResponseSchemas: {
  valibot: {
    'landing-page': {
      schema: `object({ page: LandingPageMergedSchema })`,
      name: 'LandingPageAssembledSchema',
      typeName: 'LandingPageAssembled',
    },
  },
},
```

The schema string is emitted verbatim into `views/<view>.ts` and may **reference any generated export instead of restating it** - view slices (in scope in the same file), component/content-type schemas, `UploadFileSchema`, override schemas: the generator scans the string against its export registry and adds the imports (an explicit `imports: [...]` array on the declaration is the escape hatch if resolution is ever ambiguous). Alongside the declaration it emits the plugin-owned envelope wrappers: `<TypeName>SuccessSchema` (`{ data, meta: { view } }`) and `<TypeName>ResultSchema` (union with `BffErrorEnvelopeSchema`), each with inferred types. Declarations join the generation hash, so `strapi-schemas check` fails when one changes. A declaration is a _claim_ about the hook's code - verify it at runtime (parity tests) like any assemble behavior.

## Using the generated code

### Typed client

```ts
import { createStrapiClient } from './generated';

const strapi = createStrapiClient({
  baseUrl: 'https://cms.example.com',
  token: process.env.STRAPI_TOKEN!,
});

// Validated + typed. Uses the generated deep populate by default.
const { data: articles, meta } = await strapi.articles.findMany({
  filters: { status: { $eq: 'published' } },
  sort: ['publishDate:desc'],
  pagination: { page: 1, pageSize: 10 },
});

const article = await strapi.articles.findOne(documentId);

// Single types use find() (and Strapi's singular-name endpoint)
const header = await strapi.headers.find();

// Extend the populate - the populate option is typed per content type
const withAuthor = await strapi.articles.findMany({
  populate: { image: true, author: { populate: { avatar: true } } },
});
```

The client is intentionally **read-only**: content flows admin panel → API →
consumer. Application writes should go through your own domain endpoints (which
carry business rules the generic content API cannot know), and a read-only API
token is all this client ever needs.

Hardening options and the BFF views group:

```ts
const strapi = createStrapiClient({
  baseUrl,
  token: () => process.env.BUILD_TOKEN ?? runtimeToken, // resolved per request
  retry: { maxAttempts: 3, baseDelayMs: 300 }, // network + 429/502/503/504
  defaultParams: { locale: 'en' }, // merged into every request
});

// 404 → null on by-key lookups; other failures throw StrapiRequestError
// (structured: .status, .url, .body - no message parsing)
const article = await strapi.articles.findOne(documentId); // Article | null

// Next.js ISR / AbortSignal via per-request RequestInit passthrough
await strapi.articles.findMany({ request: { next: { revalidate: 60 } } });

// With bff-views in the same app: typed view lookups, validated by the
// generated per-view schemas (declared assemble schemas included)
const page = await strapi.views.contentPage('blog/foo'); // ContentPageResponse | null
const pdp = await strapi.views.pdpPage(sku, { status: 'draft' });
```

Responses that don't match the schema throw a `StrapiSchemaValidationError` carrying the endpoint, status, and the validation issues - so a content-model drift fails loudly at the call site instead of corrupting state downstream.

### Schemas directly

```ts
import { safeParse } from 'valibot';
import { ArticleSchema, articlePopulate } from './generated';

const result = safeParse(ArticleSchema, json.data);
```

### Mocks in tests

```ts
import { mockArticle } from './generated/mocks';

const article = mockArticle({ title: 'Fixed title' }); // overrides win
```

## Behavior notes

- **Relations are always nullish** - by design. Whether a relation appears in a response depends on the `populate` parameter, not the content model, so a `required` relation would fail validation on every unpopulated request. The generated interfaces mark them `field?: Type | null`.
- **`biginteger` maps to `string`** - Strapi serializes it as a JSON string to avoid precision loss; the schemas follow suit.
- **Dual-use components** - a component used both inside a dynamic zone _and_ as a plain nested component gets a nullish `__component`, so dynamic zones containing one fall back from a discriminated union to a plain union.
- **Name collisions fail loudly** - two components with the same name in different categories (or duplicate `singularName`s) would generate colliding identifiers; the server refuses with a descriptive error instead of emitting broken code. The singular name `registry` is reserved.
- **i18n fields are excluded** - `locale`/`localizations` are filtered out of the generated schemas.
- **Private fields are excluded** - attributes with `private: true`, names in a model's `options.privateAttributes`, and the global `api.responses.privateAttributes` config never reach the generated schemas: Strapi's sanitizer strips them from every response, so a schema promising them would fail against live data.
- **Mocks are not seeded** - output varies between runs; cyclic required components mock as typed placeholders you fill via the factory's `overrides` argument.

## HTTP API

| Method | Path                                                                                        | Description                                                              |
| ------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET`  | `/api/content-schemas/schemas?target=…&nullableStyle=…&populate=…&client=…&jsdoc=…&mocks=…` | tar.gz of the generated code                                             |
| `GET`  | `/api/content-schemas/manifest`                                                             | `{ hash, pluginVersion, schemaFormatVersion, contentTypes, components }` |

The `hash` covers the content model _and_ the plugin config - any change that affects output changes the hash, which is what `--watch` polls. The CLI warns when its major version (minor on the 0.x line) differs from the server plugin's.

## Development

```bash
npm install
npm run build        # plugin server + CLI
npm test             # unit tests (vitest)
npm run test:e2e     # boots a real Strapi app, pulls both targets through the
                     # built CLI, runs runtime validation against live data
npm run type-check
npm run lint && npm run format:check
```

Changes are listed in [CHANGELOG.md](CHANGELOG.md).

The e2e suite lives in `__tests__/e2e/` with a full fixture Strapi app covering every attribute type, dynamic zones, dual-use components, cross-category nesting, circular references, and both schema targets end to end.

Contributions welcome - see [CONTRIBUTING.md](CONTRIBUTING.md) for conventions (notably: examples and fixtures use neutral, invented identifiers only). Include tests with behavior changes and run the full suite before opening a PR.

## License

[MIT](LICENSE.md)
