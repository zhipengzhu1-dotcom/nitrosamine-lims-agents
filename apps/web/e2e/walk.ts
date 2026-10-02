import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { test as playwright } from '@playwright/test';
import { API_LOG } from '../playwright.config.ts';

export { expect, type Locator, type Page } from '@playwright/test';

/** A Lab record's time as every screen shows it: UTC, then the Lab's wall clock with its offset. */
export const utcThenLabClock = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC · \d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d\d:\d\d$/;

/** Playwright's `test`, which attaches the API log lines written during a walk that fails, so a 500 can be traced. */
export const test = playwright.extend<{ apiLog: void }>({
  apiLog: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; empty means none.
    async ({}, use, info) => {
      const from = statSync(API_LOG).size;
      await use();
      if (info.status === info.expectedStatus) return;
      const path = info.outputPath('api-log.ndjson');
      writeFileSync(path, readFileSync(API_LOG).subarray(from));
      await info.attach('api-log', { path, contentType: 'text/plain' });
    },
    { auto: true },
  ],
});
