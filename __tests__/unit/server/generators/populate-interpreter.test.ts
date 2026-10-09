import { describe, it, expect } from 'vitest';

import { parseNarrowing } from '../../../../server/src/generators/populate-interpreter';

describe('parseNarrowing', () => {
  it('parses true', () => {
    expect(parseNarrowing(true)).toBe(true);
  });

  it('parses fields-only narrowing', () => {
    expect(parseNarrowing({ fields: ['a', 'b'] })).toEqual({ fields: ['a', 'b'] });
  });

  it('parses nested populate with mixed values', () => {
    const result = parseNarrowing({
      fields: ['title'],
      populate: {
        image: true,
        products: { fields: ['sku'], populate: { thumbnail: true } },
      },
    });

    expect(result).toEqual({
      fields: ['title'],
      populate: {
        image: true,
        products: { fields: ['sku'], populate: { thumbnail: true } },
      },
    });
  });

  it('parses dynamic-zone on selections', () => {
    const result = parseNarrowing({
      populate: { blocks: { on: { 'content.hero': { fields: ['heading'] } } } },
    });

    expect(result).toEqual({
      populate: { blocks: { on: { 'content.hero': { fields: ['heading'] } } } },
    });
  });

  it('ignores shape-irrelevant query keys', () => {
    expect(parseNarrowing({ fields: ['a'], sort: 'name:asc', filters: { x: 1 } })).toEqual({
      fields: ['a'],
    });
  });

  it('drops populate entries set to false', () => {
    expect(parseNarrowing({ populate: { image: false, seo: true } })).toEqual({
      populate: { seo: true },
    });
  });

  it.each([
    ['unknown top-level key', { count: true }],
    ['non-string fields entry', { fields: ['a', 3] }],
    ['non-object', 'populate-me'],
    ['false', false],
    ['array', [{ fields: ['a'] }]],
    ['unparseable nested populate value', { populate: { image: { count: true } } }],
    ['unparseable on value', { on: { 'content.hero': 42 } }],
  ])('returns null for %s', (_label, value) => {
    expect(parseNarrowing(value)).toBeNull();
  });
});
