import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // bridge/ has its own vitest setup (Node environment).
    exclude: [...configDefaults.exclude, 'bridge/**'],
  },
});
