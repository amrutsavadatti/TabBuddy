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
});
