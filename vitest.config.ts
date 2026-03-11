import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['_Reference/**', '**/node_modules/**', '**/dist/**', '**/dist-bridge/**'],
    timeout: 10000,
  },
});

