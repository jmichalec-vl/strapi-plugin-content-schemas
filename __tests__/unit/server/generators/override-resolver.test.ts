import { describe, it, expect } from 'vitest';

import {
  resolveOverride,
  collectUsedOverrides,
  type OverrideConfig,
} from '../../../../server/src/generators/override-resolver';
import type { ContentTypeIR, ComponentIR, TypeOverride } from '../../../../server/src/types';

const RENDERED_HTML_OVERRIDE: TypeOverride = {
  schema: `object({
  html: string(),
  meta: optional(record(string(), any())),
})`,
  name: 'RenderedHtmlSchema',
  typeName: 'RenderedHtml',
};

const CUSTOM_BODY_OVERRIDE: TypeOverride = {
  schema: 'string()',
  name: 'CustomBodySchema',
  typeName: 'CustomBody',
};

const EMPTY_OVERRIDES: OverrideConfig = {
  typeOverrides: {},
  fieldOverrides: {},
};

describe('resolveOverride', () => {
  it('returns null when no overrides match', () => {
    const result = resolveOverride('title', 'string', 'api::article.article', EMPTY_OVERRIDES);
    expect(result).toBeNull();
  });

  it('returns type override when type matches', () => {
    const overrides: OverrideConfig = {
      typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
      fieldOverrides: {},
    };

    const result = resolveOverride('body', 'richtext', 'api::article.article', overrides);
    expect(result).toEqual({
      typeOverride: RENDERED_HTML_OVERRIDE,
      source: 'type-override',
    });
  });

  it('returns field override when field matches', () => {
    const overrides: OverrideConfig = {
      typeOverrides: {},
      fieldOverrides: { 'api::article.article.body': CUSTOM_BODY_OVERRIDE },
    };

    const result = resolveOverride('body', 'richtext', 'api::article.article', overrides);
    expect(result).toEqual({
      typeOverride: CUSTOM_BODY_OVERRIDE,
      source: 'field-override',
    });
  });

  it('field override takes priority over type override', () => {
    const overrides: OverrideConfig = {
      typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
      fieldOverrides: { 'api::article.article.body': CUSTOM_BODY_OVERRIDE },
    };

    const result = resolveOverride('body', 'richtext', 'api::article.article', overrides);
    expect(result).toEqual({
      typeOverride: CUSTOM_BODY_OVERRIDE,
      source: 'field-override',
    });
  });

  it('type override still applies to other fields of same type', () => {
    const overrides: OverrideConfig = {
      typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
      fieldOverrides: { 'api::article.article.body': CUSTOM_BODY_OVERRIDE },
    };

    const result = resolveOverride('description', 'richtext', 'api::article.article', overrides);
    expect(result).toEqual({
      typeOverride: RENDERED_HTML_OVERRIDE,
      source: 'type-override',
    });
  });

  it('does not match field override on different parent UID', () => {
    const overrides: OverrideConfig = {
      typeOverrides: {},
      fieldOverrides: { 'api::article.article.body': CUSTOM_BODY_OVERRIDE },
    };

    const result = resolveOverride('body', 'richtext', 'api::page.page', overrides);
    expect(result).toBeNull();
  });
});

describe('collectUsedOverrides', () => {
  const makeCt = (uid: string, attrs: ContentTypeIR['attributes']): ContentTypeIR => ({
    uid,
    singularName: uid.split('.').pop()!,
    pluralName: `${uid.split('.').pop()!}s`,
    displayName: uid.split('.').pop()!,
    kind: 'collectionType',
    attributes: attrs,
  });

  const makeComp = (uid: string, attrs: ComponentIR['attributes']): ComponentIR => ({
    uid,
    category: uid.split('.')[0] ?? uid,
    displayName: uid.split('.')[1] ?? uid,
    attributes: attrs,
  });

  it('returns empty array when no overrides used', () => {
    const result = collectUsedOverrides(
      [makeCt('api::article.article', [{ name: 'title', type: 'string', required: true }])],
      [],
      EMPTY_OVERRIDES,
    );

    expect(result).toEqual([]);
  });

  it('collects type overrides used by content types', () => {
    const overrides: OverrideConfig = {
      typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
      fieldOverrides: {},
    };

    const result = collectUsedOverrides(
      [makeCt('api::article.article', [{ name: 'body', type: 'richtext', required: false }])],
      [],
      overrides,
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('RenderedHtmlSchema');
  });

  it('collects type overrides used by components', () => {
    const overrides: OverrideConfig = {
      typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
      fieldOverrides: {},
    };

    const result = collectUsedOverrides(
      [],
      [makeComp('hero.hero-section', [{ name: 'title', type: 'richtext', required: true }])],
      overrides,
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('RenderedHtmlSchema');
  });

  it('deduplicates overrides used by multiple schemas', () => {
    const overrides: OverrideConfig = {
      typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
      fieldOverrides: {},
    };

    const result = collectUsedOverrides(
      [
        makeCt('api::article.article', [{ name: 'body', type: 'richtext', required: false }]),
        makeCt('api::page.page', [{ name: 'content', type: 'richtext', required: false }]),
      ],
      [],
      overrides,
    );

    expect(result).toHaveLength(1);
  });

  it('field override takes priority in collection', () => {
    const overrides: OverrideConfig = {
      typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
      fieldOverrides: { 'api::article.article.body': CUSTOM_BODY_OVERRIDE },
    };

    const result = collectUsedOverrides(
      [makeCt('api::article.article', [{ name: 'body', type: 'richtext', required: false }])],
      [],
      overrides,
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('CustomBodySchema');
  });

  it('collects both type and field overrides when both apply to different fields', () => {
    const overrides: OverrideConfig = {
      typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
      fieldOverrides: { 'api::article.article.body': CUSTOM_BODY_OVERRIDE },
    };

    const result = collectUsedOverrides(
      [
        makeCt('api::article.article', [
          { name: 'body', type: 'richtext', required: false },
          { name: 'excerpt', type: 'richtext', required: false },
        ]),
      ],
      [],
      overrides,
    );

    expect(result).toHaveLength(2);
    const names = result.map((o) => o.name);
    expect(names).toContain('CustomBodySchema');
    expect(names).toContain('RenderedHtmlSchema');
  });
});
