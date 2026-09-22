import { openOrFocusDashboard } from '@/lib/dashboard';

export default defineBackground(() => {
  browser.commands.onCommand.addListener((command) => {
    if (command === 'open-dashboard') {
      openOrFocusDashboard();
    }
  });
});
