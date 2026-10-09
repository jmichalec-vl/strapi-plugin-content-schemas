import { describe, it, expect, beforeEach, vi } from 'vitest';

import generator from '../../../../server/src/services/generator';
import type { Core } from '@strapi/types';
import type { GenerationOptions } from '../../../../server/src/types';

const MOCK_FILES = new Map([
  ['index.ts', 'export {}'],
  ['content-types/article.ts', 'schema code'],
]);

const DEFAULT_OPTIONS: GenerationOptions = {
  target: 'valibot',
  nullableStyle: 'nullish',
  generatePopulate: true,
  generateClient: true,
  jsdoc: false,
  mocks: false,
  typeOverrides: {},
  fieldOverrides: {},
  viewTransformSchemas: {},
  viewResponseSchemas: {},
  nameOverrides: {},
};

const createMockGeneratorStrapi = () => {
  const mockReader = {
    readContentTypes: vi.fn().mockReturnValue([
      {
        uid: 'api::article.article',
        singularName: 'article',
        pluralName: 'articles',
        displayName: 'Article',
        kind: 'collectionType',
        attributes: [{ name: 'title', type: 'string', required: true }],
      },
    ]),
    readComponents: vi.fn().mockReturnValue([]),
  };

  const mockWriter = {
    buildSchemaFiles: vi.fn().mockReturnValue(MOCK_FILES),
  };

  const configValues: Record<string, unknown> = {
    contentTypes: ['api::*'],
    components: 'referenced',
    includeInternalFields: { timestamps: false },
    typeOverrides: {},
    fieldOverrides: {},
    viewTransformSchemas: {},
    viewResponseSchemas: {},
    nameOverrides: {},
  };

  const mockConfigFn = (key: string) => configValues[key];

  const services = new Map<string, unknown>();
  services.set('content-schemas::schema-reader', mockReader);
  services.set('content-schemas::code-writer', mockWriter);

  const mockStrapi = {
    plugin: vi.fn(() => ({
      service: vi.fn((name: string) => {
        const key = `content-schemas::${name}`;
        return services.get(key) ?? {};
      }),
      config: mockConfigFn,
    })),
    log: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
  };

  return { strapi: mockStrapi, mockReader, mockWriter };
};

describe('generator', () => {
  let mock: ReturnType<typeof createMockGeneratorStrapi>;
  let gen: ReturnType<typeof generator>;

  beforeEach(() => {
    mock = createMockGeneratorStrapi();
    gen = generator({ strapi: mock.strapi as unknown as Core.Strapi });
  });

  describe('generate', () => {
    it('returns in-memory file map', () => {
      const files = gen.generate(DEFAULT_OPTIONS);

      expect(files).toBe(MOCK_FILES);
      expect(mock.mockReader.readContentTypes).toHaveBeenCalled();
      expect(mock.mockWriter.buildSchemaFiles).toHaveBeenCalled();
    });

    it('passes generation options to writer', () => {
      gen.generate(DEFAULT_OPTIONS);

      expect(mock.mockWriter.buildSchemaFiles).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        DEFAULT_OPTIONS,
        null,
      );
    });

    it('updates last generation status', () => {
      expect(gen.getStatus()).toBeNull();

      gen.generate(DEFAULT_OPTIONS);

      const status = gen.getStatus();
      expect(status).not.toBeNull();
      expect(status!.fileCount).toBe(2);
      expect(status!.contentTypes).toEqual(['api::article.article']);
      expect(status!.timestamp).toBeDefined();
      expect(status!.hash).toBeDefined();
      expect(typeof status!.hash).toBe('string');
    });
  });

  describe('getManifest', () => {
    it('returns manifest with fresh schema hash', () => {
      const manifest = gen.getManifest();
      expect(manifest.contentTypes).toEqual(['api::article.article']);
      expect(manifest.components).toEqual([]);
      expect(manifest.hash).toBeDefined();
      expect(typeof manifest.hash).toBe('string');
    });

    it('includes plugin and schema-format versions', () => {
      const manifest = gen.getManifest();
      expect(manifest.pluginVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(manifest.schemaFormatVersion).toBeGreaterThanOrEqual(1);
      expect(manifest.fileCount).toBeNull();
    });
  });

  describe('getTarball', () => {
    it('returns a gzip buffer', () => {
      const tarball = gen.getTarball(DEFAULT_OPTIONS);
      expect(Buffer.isBuffer(tarball)).toBe(true);
      // gzip magic bytes
      expect(tarball[0]).toBe(0x1f);
      expect(tarball[1]).toBe(0x8b);
    });

    it('caches the tarball for identical options and unchanged schemas', () => {
      const first = gen.getTarball(DEFAULT_OPTIONS);
      const second = gen.getTarball(DEFAULT_OPTIONS);

      expect(second).toBe(first);
      expect(mock.mockWriter.buildSchemaFiles).toHaveBeenCalledTimes(1);
    });

    it('regenerates for different generation options', () => {
      gen.getTarball(DEFAULT_OPTIONS);
      gen.getTarball({ ...DEFAULT_OPTIONS, target: 'zod' });

      expect(mock.mockWriter.buildSchemaFiles).toHaveBeenCalledTimes(2);
    });

    it('invalidates the cache when the content model changes', () => {
      gen.getTarball(DEFAULT_OPTIONS);

      mock.mockReader.readContentTypes.mockReturnValue([
        {
          uid: 'api::article.article',
          singularName: 'article',
          pluralName: 'articles',
          displayName: 'Article',
          kind: 'collectionType',
          attributes: [{ name: 'renamed', type: 'string', required: true }],
        },
      ]);

      gen.getTarball(DEFAULT_OPTIONS);
      expect(mock.mockWriter.buildSchemaFiles).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStatus', () => {
    it('returns null before any generation', () => {
      expect(gen.getStatus()).toBeNull();
    });

    it('returns status after generation', () => {
      gen.generate(DEFAULT_OPTIONS);
      expect(gen.getStatus()).not.toBeNull();
    });
  });
});
