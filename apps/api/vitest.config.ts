import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./src/testing/global-setup.ts'],
    testTimeout: 600_000, // a person has three TOTP codes per 30 s; a fourth signing waits for the next period
    hookTimeout: 900_000, // the chain test seeds the whole demo dataset first, through the real signings
  },
});
