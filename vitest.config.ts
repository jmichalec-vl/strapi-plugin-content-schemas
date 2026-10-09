import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/unit/**/*.test.ts'],
    restoreMocks: true,
    mockReset: true,
    coverage: {
      provider: 'v8',
      include: ['server/src/**/*.ts', 'cli/src/**/*.ts'],
      exclude: [
        'server/src/types/**',
        'server/src/**/index.ts',
        'server/src/routes/**',
        'cli/src/index.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
