import { describe, it, expect } from 'vitest';

import {
  collectEnumArtifacts,
  enumKeyName,
  generateEnumArtifactCode,
} from '../../../../server/src/generators/enum-generator';
import type { AttributeIR } from '../../../../server/src/types';

const enumAttr = (name: string, values: readonly string[], enumName?: string): AttributeIR => ({
  name,
  type: 'enumeration',
  required: true,
  enumValues: values,
  ...(enumName && { enumName }),
});

describe('enumKeyName', () => {
  it.each([
    ['At-home test kit', 'AtHomeTestKit'],
    ['draft', 'Draft'],
    ['in_review', 'InReview'],
    ['local pickup', 'LocalPickup'],
    ['gift_card', 'GiftCard'],
    // all-caps segments title-case ('SOCIAL_NETWORK' → SocialNetwork)
    ['VAT', 'Vat'],
    ['iPhone', 'IPhone'],
    ['top10', 'Top10'],
    ['10days', '_10days'],
    ['---', 'Empty'],
  ])('%s → %s', (value, expected) => {
    expect(enumKeyName(value)).toBe(expected);
  });
});

describe('collectEnumArtifacts', () => {
  it('names artifacts ParentType + PascalCase(attr)', () => {
    const artifacts = collectEnumArtifacts('Order', [
      enumAttr('collectionMethod', ['At-home test kit', 'Walk-in test visit']),
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.name).toBe('OrderCollectionMethod');
  });

  it('honors the Strapi enumName hint', () => {
    const artifacts = collectEnumArtifacts('Order', [
      enumAttr('collectionMethod', ['a'], 'COLLECTION_METHOD'),
    ]);

    expect(artifacts[0]!.name).toBe('CollectionMethod');
  });

  it('shares one artifact for attrs with the same enumName and identical values', () => {
    const artifacts = collectEnumArtifacts('Order', [
      enumAttr('primary', ['a', 'b'], 'SHARED_ENUM'),
      enumAttr('secondary', ['a', 'b'], 'SHARED_ENUM'),
    ]);

    expect(artifacts).toHaveLength(1);
  });

  it('falls back to per-attr naming when a shared enumName has divergent values', () => {
    const artifacts = collectEnumArtifacts('Order', [
      enumAttr('primary', ['a'], 'SHARED_ENUM'),
      enumAttr('secondary', ['b'], 'SHARED_ENUM'),
    ]);

    expect(artifacts.map((a) => a.name).sort()).toEqual(['OrderSecondary', 'SharedEnum']);
  });

  it('suffixes Enum when the name would redeclare a parent export', () => {
    const artifacts = collectEnumArtifacts('Article', [
      enumAttr('schema', ['a']),
      enumAttr('kind', ['x'], 'Article'),
      enumAttr('populateInput', ['p']),
    ]);

    expect(artifacts.map((a) => a.name)).toEqual([
      'ArticleSchemaEnum',
      'ArticleEnum',
      'ArticlePopulateInputEnum',
    ]);
  });

  it('skips enums without values and non-enum attributes', () => {
    const artifacts = collectEnumArtifacts('Order', [
      enumAttr('empty', []),
      { name: 'title', type: 'string', required: true },
    ]);

    expect(artifacts).toEqual([]);
  });
});

describe('generateEnumArtifactCode', () => {
  it('emits a merged const object and type with raw values', () => {
    const code = generateEnumArtifactCode(
      collectEnumArtifacts('Order', [
        enumAttr('collectionMethod', ['At-home test kit', "it's live"]),
      ]),
    );

    expect(code).toContain('export const OrderCollectionMethod = {');
    expect(code).toContain("  AtHomeTestKit: 'At-home test kit',");
    expect(code).toContain("  ItSLive: 'it\\'s live',");
    expect(code).toContain('} as const;');
    expect(code).toContain(
      'export type OrderCollectionMethod = (typeof OrderCollectionMethod)[keyof typeof OrderCollectionMethod];',
    );
  });

  it('suffixes keys when distinct values sanitize identically', () => {
    const code = generateEnumArtifactCode(
      collectEnumArtifacts('X', [enumAttr('f', ['a-b', 'a b'])]),
    );

    expect(code).toContain("  AB: 'a-b',");
    expect(code).toContain("  AB2: 'a b',");
  });

  it('returns null when there is nothing to emit', () => {
    expect(generateEnumArtifactCode([])).toBeNull();
  });
});
