import { beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

beforeEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
});
