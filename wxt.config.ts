import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'TabBuddy',
    description: 'Snapshot and restore browser window tab groups.',
    permissions: ['tabs', 'tabGroups', 'windows', 'storage', 'sessions', 'alarms'],
    commands: {
      'open-dashboard': {
        suggested_key: {
          default: 'Ctrl+Shift+K',
          mac: 'Command+Shift+K',
        },
        description: 'Open TabBuddy dashboard',
      },
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
