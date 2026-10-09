import { describe, it, expect } from 'vitest';
import ts from 'typescript';

import { generateQueryStringCode } from '../../../../server/src/generators/client-generator';

// The serializer only exists as an emitted code string - compile and evaluate it
// so the tests exercise the exact code consumers receive
const loadSerializer = (): ((params: Record<string, unknown>) => string) => {
  const source = generateQueryStringCode();
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  new Function('exports', 'module', js)(moduleObj.exports, moduleObj);
  return moduleObj.exports.serializeQuery as (params: Record<string, unknown>) => string;
};

describe('generated serializeQuery', () => {
  const serializeQuery = loadSerializer();

  it('serializes nested populate objects in Strapi bracket syntax', () => {
    const result = serializeQuery({
      populate: { seo: { populate: { metaImage: true } }, images: true },
    });

    expect(result).toBe('populate[seo][populate][metaImage]=true&populate[images]=true');
  });

  it('serializes dynamic zone on: syntax with dotted component uids', () => {
    const result = serializeQuery({
      populate: { modules: { on: { 'hero.hero-section': { populate: { image: true } } } } },
    });

    expect(result).toBe('populate[modules][on][hero.hero-section][populate][image]=true');
  });

  it('serializes filters with operators and encodes values only', () => {
    const result = serializeQuery({ filters: { slug: { $eq: 'a b&c' } } });

    expect(result).toBe('filters[slug][$eq]=a%20b%26c');
  });

  it('serializes arrays with numeric indices', () => {
    const result = serializeQuery({ sort: ['title:desc', 'slug:asc'], fields: ['title'] });

    expect(result).toBe('sort[0]=title%3Adesc&sort[1]=slug%3Aasc&fields[0]=title');
  });

  it('serializes pagination and scalar params', () => {
    const result = serializeQuery({
      pagination: { page: 2, pageSize: 10 },
      status: 'draft',
    });

    expect(result).toBe('pagination[page]=2&pagination[pageSize]=10&status=draft');
  });

  it('skips undefined values and serializes null as empty', () => {
    const result = serializeQuery({ filters: undefined, a: null, b: 'x' });

    expect(result).toBe('a=&b=x');
  });

  it('serializes Date values as ISO strings instead of dropping them', () => {
    const date = new Date('2024-06-01T12:00:00.000Z');
    const result = serializeQuery({ filters: { createdAt: { $gt: date } } });

    expect(result).toBe(
      `filters[createdAt][$gt]=${encodeURIComponent('2024-06-01T12:00:00.000Z')}`,
    );
  });
});
