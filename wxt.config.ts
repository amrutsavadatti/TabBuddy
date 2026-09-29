import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: (env) => ({
    name: 'TabBuddy',
    description: 'Snapshot and restore browser window tab groups.',
    permissions: [
      'tabs',
      // Native tab-group capture/restore/auto-group is Chrome-only; the
      // permission doesn't exist on other browsers, and the code already
      // no-ops those features there (see lib/tabGroupsSupport.ts).
      ...(env.browser === 'chrome' ? ['tabGroups' as const] : []),
      'windows',
      'storage',
      'sessions',
      'alarms',
      'idle',
    ],
    // Requested only when the user turns on the agent bridge. Chromium only:
    // installing the bridge on Firefox isn't supported yet, and declaring a
    // permission there that nothing can use risks the store review.
    optional_permissions: env.browser === 'chrome' ? ['nativeMessaging' as const] : [],
    commands: {
      'open-dashboard': {
        suggested_key: {
          default: 'Ctrl+Shift+K',
          mac: 'Command+Shift+K',
        },
        description: 'Open TabBuddy dashboard',
      },
    },
  }),
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  zip: {
    // Firefox review requires a sources ZIP; without this, WXT sweeps up the
    // whole repo root, including the multi-GB Website/ folder (screen
    // recordings etc.) that isn't part of the extension's source. bridge/ is
    // the separate tabbuddy-bridge npm package, except bridge/protocol.ts,
    // which the extension imports and so must stay in the sources.
    excludeSources: [
      'Website/**',
      'bridge/src/**',
      'bridge/dist/**',
      'bridge/node_modules/**',
      'bridge/package.json',
      'bridge/package-lock.json',
      'bridge/tsconfig*.json',
      'bridge/vitest.config.ts',
      'bridge/README.md',
      'bridge/.*',
    ],
  },
});
