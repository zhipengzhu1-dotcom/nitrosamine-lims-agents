import { test as playwright } from '@playwright/test';
import { API_LOG } from '../playwright.config.ts';

export { expect, type Locator, type Page } from '@playwright/test';

/** Playwright's `test`, which attaches the e2e API log to every walk that fails, so a 500 can be traced. */
export const test = playwright.extend<{ apiLog: void }>({
  apiLog: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; empty means none.
    async ({}, use, info) => {
      await use();
      if (info.status !== info.expectedStatus)
        await info.attach('api-log', { path: API_LOG, contentType: 'text/plain' });
    },
    { auto: true },
  ],
});
