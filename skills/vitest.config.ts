import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['**/index.ts'],
      exclude: ['**/shared/**'],
    },
  },
  resolve: {
    alias: {
      '@aetheros/shared': path.resolve(__dirname, 'shared/index.ts'),
    },
  },
});
