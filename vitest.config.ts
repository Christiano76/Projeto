import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@agency/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@/': path.resolve(__dirname, 'apps/web/src') + '/',
      'server-only': path.resolve(__dirname, 'scripts/test-stubs/empty.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/web/src/**/*.test.ts', 'supabase/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
