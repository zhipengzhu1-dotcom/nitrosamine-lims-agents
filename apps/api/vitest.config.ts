import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./src/testing/global-setup.ts'],
    testTimeout: 180_000, // a person has three TOTP codes per 30 s; a fourth signing waits for the next period
    hookTimeout: 120_000,
  },
});
