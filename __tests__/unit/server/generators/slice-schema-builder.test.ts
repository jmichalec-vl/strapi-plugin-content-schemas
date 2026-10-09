import { describe, it, expect, vi } from 'vitest';

import {
  buildComponentSlice,
  buildContentTypeSlice,
  type SliceContext,
} from '../../../../server/src/generators/slice-schema-builder';
import { buildSchemaRegistry } from '../../../../server/src/generators/schema-registry';
import { valibotPrimitives } from '../../../../server/src/mappers/valibot/primitives';
import type { ComponentIR, ContentTypeIR } from '../../../../server/src/types';

const PAGE: ContentTypeIR = {
  uid: 'api::page.page',
  singularName: 'page',
  pluralName: 'pages',
  displayName: 'Page',
  kind: 'collectionType',
  attributes: [
    { name: 'documentId', type: 'string', required: true },
    { name: 'title', type: 'string', required: true },
    { name: 'body', type: 'richtext', required: false },
    { name: 'seo', type: 'component', required: false, componentUID: 'shared.seo' },
    { name: 'modules', type: 'dynamiczone', required: true, componentUIDs: ['content.hero'] },
    {
      name: 'author',
      type: 'relation',
      required: true,
      relationKind: 'manyToOne',
      relationTarget: 'api::author.author',
    },
    {
      name: 'ghost',
      type: 'relation',
      required: false,
      relationKind: 'manyToOne',
      relationTarget: 'api::ghost.ghost',
    },
  ],
};

const AUTHOR: ContentTypeIR = {
  uid: 'api::author.author',
  singularName: 'author',
  pluralName: 'authors',
  displayName: 'Author',
  kind: 'collectionType',
  attributes: [
    { name: 'documentId', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'bio', type: 'richtext', required: false },
  ],
};

const SEO: ComponentIR = {
  uid: 'shared.seo',
  category: 'shared',
  displayName: 'SEO',
  attributes: [
    { name: 'metaTitle', type: 'string', required: true },
    { name: 'metaImage', type: 'media', required: false, mediaMultiple: false },
  ],
};

const HERO: ComponentIR = {
  uid: 'content.hero',
  category: 'content',
  displayName: 'Hero',
  attributes: [
    { name: 'heading', type: 'string', required: true },
    { name: 'tagline', type: 'text', required: false },
    { name: 'image', type: 'media', required: false, mediaMultiple: true },
  ],
};

const contentTypes = [PAGE, AUTHOR];
const components = [SEO, HERO];

const makeContext = (overrides: Partial<SliceContext> = {}): SliceContext => ({
  primitives: valibotPrimitives,
  registry: buildSchemaRegistry(contentTypes, components),
  nullableStyle: 'nullish',
  componentsByUid: new Map(components.map((c) => [c.uid, c])),
  contentTypesByUid: new Map(contentTypes.map((ct) => [ct.uid, ct])),
  overrideConfig: { typeOverrides: {}, fieldOverrides: {} },
  resolveTransformExpression: () => null,
  ...overrides,
});

describe('buildComponentSlice', () => {
  it('emits every scalar and no populatable field for `true`', () => {
    const warn = vi.fn();
    const slice = buildComponentSlice('shared.seo', true, false, 0, makeContext(), warn);

    expect(slice.expression).toContain('id: number(),');
    expect(slice.expression).toContain('metaTitle: string(),');
    expect(slice.expression).not.toContain('metaImage');
    expect(slice.expression).not.toContain('__component');
    expect(warn).not.toHaveBeenCalled();
  });

  it('adds a required __component literal when asked for one', () => {
    const slice = buildComponentSlice('shared.seo', true, true, 0, makeContext(), vi.fn());

    expect(slice.expression).toContain("__component: literal('shared.seo'),");
  });

  it('restricts scalars to the selected fields', () => {
    const slice = buildComponentSlice(
      'content.hero',
      { fields: ['heading'] },
      false,
      0,
      makeContext(),
      vi.fn(),
    );

    expect(slice.expression).toContain('heading: string(),');
    expect(slice.expression).not.toContain('tagline');
  });

  it('warns about a selected field the component does not have', () => {
    const warn = vi.fn();
    buildComponentSlice('content.hero', { fields: ['nope'] }, false, 0, makeContext(), warn);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nope'));
  });

  it('references the shared upload-file schema for fully populated media', () => {
    const slice = buildComponentSlice(
      'shared.seo',
      { populate: { metaImage: true } },
      false,
      0,
      makeContext(),
      vi.fn(),
    );

    expect(slice.expression).toContain('metaImage: nullish(UploadFileSchema),');
    expect(slice.externalRefs).toContain('UploadFileSchema');
  });

  it('inlines a media slice when the populate selects upload-file fields', () => {
    const slice = buildComponentSlice(
      'content.hero',
      { populate: { image: { fields: ['url', 'width'] } } },
      false,
      0,
      makeContext(),
      vi.fn(),
    );

    expect(slice.expression).toMatch(/image: nullish\(array\(object\(\{/);
    expect(slice.expression).toContain('url: string(),');
    expect(slice.expression).toContain('width: nullish(number()),');
    expect(slice.externalRefs).not.toContain('UploadFileSchema');
  });

  it('applies a transform override to a scalar and records the reference', () => {
    const ctx = makeContext({
      resolveTransformExpression: (attr) =>
        attr.name === 'tagline'
          ? { expression: 'RenderedHtmlSchema', externalRefs: ['RenderedHtmlSchema'] }
          : null,
    });
    const slice = buildComponentSlice('content.hero', true, false, 0, ctx, vi.fn());

    expect(slice.expression).toContain('tagline: nullish(RenderedHtmlSchema),');
    expect(slice.externalRefs).toContain('RenderedHtmlSchema');
  });

  it('degrades an uncovered transform to unknown with a warning', () => {
    const warn = vi.fn();
    const ctx = makeContext({
      resolveTransformExpression: (attr) => (attr.name === 'tagline' ? 'uncovered' : null),
    });
    const slice = buildComponentSlice('content.hero', true, false, 0, ctx, warn);

    expect(slice.expression).toContain('tagline: nullish(unknown()),');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tagline'));
  });

  it('emits unknown for a component that is not generated', () => {
    const warn = vi.fn();
    const slice = buildComponentSlice('missing.one', true, false, 0, makeContext(), warn);

    expect(slice.expression).toContain('unknown()');
    expect(warn).toHaveBeenCalled();
  });
});

describe('buildContentTypeSlice', () => {
  it('promises id and documentId and keeps relations nullish', () => {
    const slice = buildContentTypeSlice(
      'api::page.page',
      { populate: { author: { fields: ['name'] } } },
      0,
      makeContext(),
      vi.fn(),
    );

    expect(slice.expression).toContain('id: number(),');
    expect(slice.expression).toContain('documentId: string(),');
    expect(slice.expression).toMatch(/author: nullish\(object\(\{/);
    expect(slice.expression).toContain('name: string(),');
  });

  it('never applies transforms: content-type slices only exist below a relation boundary', () => {
    const ctx = makeContext({
      resolveTransformExpression: (attr) =>
        attr.type === 'richtext'
          ? { expression: 'RenderedHtmlSchema', externalRefs: ['RenderedHtmlSchema'] }
          : null,
    });
    const slice = buildContentTypeSlice(
      'api::page.page',
      { fields: ['body'], populate: { author: true } },
      0,
      ctx,
      vi.fn(),
    );

    expect(slice.expression).toContain('body: nullish(string()),');
    expect(slice.expression).toContain('bio: nullish(string()),');
    expect(slice.expression).not.toContain('RenderedHtmlSchema');
  });

  it('builds a discriminated zone from `on` members and warns for non-members', () => {
    const warn = vi.fn();
    const slice = buildContentTypeSlice(
      'api::page.page',
      { populate: { modules: { on: { 'content.hero': true, 'shared.seo': true } } } },
      0,
      makeContext(),
      warn,
    );

    expect(slice.expression).toMatch(/modules: array\(variant\('__component', \[/);
    expect(slice.expression).toContain("__component: literal('content.hero'),");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('shared.seo'));
  });

  it('emits an unknown array for a zone populated without `on`', () => {
    const warn = vi.fn();
    const slice = buildContentTypeSlice(
      'api::page.page',
      { populate: { modules: true } },
      0,
      makeContext(),
      warn,
    );

    expect(slice.expression).toContain('modules: array(unknown()),');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('modules'));
  });

  it('emits unknown for a relation whose target is not generated', () => {
    const warn = vi.fn();
    const slice = buildContentTypeSlice(
      'api::page.page',
      { populate: { ghost: true } },
      0,
      makeContext(),
      warn,
    );

    expect(slice.expression).toContain('ghost: nullish(unknown()),');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('api::ghost.ghost'));
  });

  it('accepts timestamp selections the IR excludes', () => {
    const slice = buildContentTypeSlice(
      'api::page.page',
      { fields: ['title', 'updatedAt'] },
      0,
      makeContext(),
      vi.fn(),
    );

    expect(slice.expression).toContain('updatedAt: nullish(string()),');
  });
});
