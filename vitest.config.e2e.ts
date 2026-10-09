import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/e2e/**/*.test.ts'],
    globalSetup: ['__tests__/e2e/helpers/strapi-instance.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One Strapi instance serves every file, so files run one at a time in a
    // single worker
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
  },
});
