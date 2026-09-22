import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'TabBuddy',
    description: 'Snapshot and restore browser window tab groups.',
    permissions: ['tabs', 'tabGroups', 'windows', 'storage'],
  },
});
