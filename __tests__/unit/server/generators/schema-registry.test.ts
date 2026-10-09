import { describe, it, expect } from 'vitest';

import {
  buildSchemaRegistry,
  buildReverseMap,
  classifyExternalRef,
} from '../../../../server/src/generators/schema-registry';
import type { ComponentIR, ContentTypeIR } from '../../../../server/src/types';

const ARTICLE: ContentTypeIR = {
  uid: 'api::article.article',
  singularName: 'article',
  pluralName: 'articles',
  displayName: 'Article',
  kind: 'collectionType',
  attributes: [],
};

const SEO: ComponentIR = {
  uid: 'shared.seo',
  category: 'shared',
  displayName: 'SEO',
  attributes: [],
};

describe('buildSchemaRegistry', () => {
  it('maps uids to their schema variable names', () => {
    const registry = buildSchemaRegistry([ARTICLE], [SEO]);

    expect(registry.contentTypes.get('api::article.article')).toBe('ArticleSchema');
    expect(registry.components.get('shared.seo')).toBe('SharedSeoSchema');
  });

  it('omits the optional usage sets unless provided', () => {
    expect(buildSchemaRegistry([], [])).toEqual({ components: new Map(), contentTypes: new Map() });

    const registry = buildSchemaRegistry([], [SEO], new Set(['shared.seo']), new Set());
    expect(registry.dualUseUIDs?.has('shared.seo')).toBe(true);
    expect(registry.cycleUIDs?.size).toBe(0);
  });
});

describe('classifyExternalRef', () => {
  const reverseMap = buildReverseMap(buildSchemaRegistry([ARTICLE], [SEO]));

  it('classifies the upload-file schema, components, content types and overrides', () => {
    expect(classifyExternalRef('UploadFileSchema', reverseMap)).toEqual({
      schemaVarName: 'UploadFileSchema',
      source: 'upload-file',
    });
    expect(classifyExternalRef('SharedSeoSchema', reverseMap)).toEqual({
      schemaVarName: 'SharedSeoSchema',
      source: 'component',
      uid: 'shared.seo',
    });
    expect(classifyExternalRef('ArticleSchema', reverseMap)).toEqual({
      schemaVarName: 'ArticleSchema',
      source: 'content-type',
      uid: 'api::article.article',
    });
    expect(classifyExternalRef('RenderedHtmlSchema', reverseMap)).toEqual({
      schemaVarName: 'RenderedHtmlSchema',
      source: 'override',
    });
  });
});
