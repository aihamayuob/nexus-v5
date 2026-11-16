import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['modules/**/*.mjs'],
      exclude: ['modules/**/*.test.mjs'],
    },
  },
});
