import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Core } from '@strapi/types';

import contentSchemasController, {
  type ApiContext,
} from '../../../../server/src/controllers/content-schemas';
import { GenerationError } from '../../../../server/src/errors';

const createMockStrapi = () => {
  const mockGenerator = {
    generate: vi.fn().mockReturnValue(new Map([['index.ts', 'export {}']])),
    getTarball: vi.fn().mockReturnValue(Buffer.from([0x1f, 0x8b])),
    getManifest: vi.fn().mockReturnValue({ hash: 'abc', fileCount: null }),
    getStatus: vi.fn().mockReturnValue(null),
  };

  const configValues: Record<string, unknown> = {
    typeOverrides: {},
    fieldOverrides: {},
  };

  const mockStrapi = {
    plugin: vi.fn(() => ({
      service: vi.fn(() => mockGenerator),
      config: (key: string) => configValues[key],
    })),
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  };

  return { strapi: mockStrapi, mockGenerator };
};

const createMockContext = (query: Record<string, string | string[] | undefined>): ApiContext => ({
  query,
  body: undefined,
  set: vi.fn(),
  badRequest: vi.fn(),
  internalServerError: vi.fn(),
});

describe('content-schemas controller', () => {
  let mock: ReturnType<typeof createMockStrapi>;
  let controller: ReturnType<typeof contentSchemasController>;

  beforeEach(() => {
    mock = createMockStrapi();
    controller = contentSchemasController({ strapi: mock.strapi as unknown as Core.Strapi });
  });

  describe('getSchemas', () => {
    it('returns the tarball with gzip headers for valid params', async () => {
      const ctx = createMockContext({ target: 'valibot' });
      await controller.getSchemas(ctx);

      expect(mock.mockGenerator.getTarball).toHaveBeenCalled();
      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'application/gzip');
      expect(Buffer.isBuffer(ctx.body)).toBe(true);
      expect(ctx.badRequest).not.toHaveBeenCalled();
    });

    it('responds 400 for an invalid target', async () => {
      const ctx = createMockContext({ target: 'yup' });
      await controller.getSchemas(ctx);

      expect(ctx.badRequest).toHaveBeenCalledWith(expect.stringContaining('Invalid target'));
      expect(mock.mockGenerator.getTarball).not.toHaveBeenCalled();
    });

    it('responds 400 for an invalid nullableStyle', async () => {
      const ctx = createMockContext({ nullableStyle: 'wat' });
      await controller.getSchemas(ctx);

      expect(ctx.badRequest).toHaveBeenCalledWith(expect.stringContaining('Invalid nullableStyle'));
      expect(mock.mockGenerator.getTarball).not.toHaveBeenCalled();
    });
  });

  describe('getSchemas failure mapping', () => {
    it('returns a GenerationError message so the consumer can act on it', async () => {
      mock.mockGenerator.getTarball.mockImplementation(() => {
        throw new GenerationError('[content-schemas] Name collision in generated output: X');
      });
      const ctx = createMockContext({});
      await controller.getSchemas(ctx);

      expect(ctx.internalServerError).toHaveBeenCalledWith(
        expect.stringContaining('Name collision'),
      );
    });

    it('hides unexpected errors behind a generic message and logs the detail', async () => {
      mock.mockGenerator.getTarball.mockImplementation(() => {
        throw new TypeError('Cannot read properties of undefined (reading "attributes")');
      });
      const ctx = createMockContext({});
      await controller.getSchemas(ctx);

      expect(ctx.internalServerError).toHaveBeenCalledWith(expect.stringContaining('server log'));
      expect(ctx.internalServerError).not.toHaveBeenCalledWith(
        expect.stringContaining('Cannot read properties'),
      );
      expect(mock.strapi.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Cannot read properties'),
      );
    });
  });

  describe('getManifest', () => {
    it('returns the generator manifest', async () => {
      const ctx = createMockContext({});
      await controller.getManifest(ctx);

      expect(ctx.body).toEqual({ hash: 'abc', fileCount: null });
    });
  });
});
