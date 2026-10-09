import { vi } from 'vitest';

export const createMockStrapi = () => {
  const services = new Map<string, Record<string, unknown>>();

  const mockStrapi = {
    contentTypes: {} as Record<string, Record<string, unknown>>,
    components: {} as Record<string, Record<string, unknown>>,

    plugin: vi.fn((pluginId: string) => ({
      service: vi.fn((name: string) => {
        const key = `${pluginId}::${name}`;
        return services.get(key) ?? {};
      }),
      config: {} as Record<string, unknown>,
    })),

    config: {
      get: vi.fn().mockReturnValue('development'),
    },

    log: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
  };

  return {
    strapi: mockStrapi,
    services,

    setContentTypes: (types: Record<string, Record<string, unknown>>) => {
      mockStrapi.contentTypes = types;
    },

    setComponents: (components: Record<string, Record<string, unknown>>) => {
      mockStrapi.components = components;
    },

    registerService: (pluginId: string, name: string, svc: Record<string, unknown>) => {
      services.set(`${pluginId}::${name}`, svc);
    },

    setPluginConfig: (config: Record<string, unknown>) => {
      mockStrapi.plugin = vi.fn((pluginId: string) => ({
        service: vi.fn((name: string) => {
          const key = `${pluginId}::${name}`;
          return services.get(key) ?? {};
        }),
        config,
      }));
    },
  };
};

export type MockStrapi = ReturnType<typeof createMockStrapi>;
