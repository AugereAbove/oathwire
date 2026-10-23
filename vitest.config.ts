import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 10000,
    projects: [
      {
        extends: true,
        test: { name: 'server', environment: 'node', include: ['tests/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'web', environment: 'jsdom', include: ['tests/**/*.test.tsx'] },
      },
    ],
  },
});
