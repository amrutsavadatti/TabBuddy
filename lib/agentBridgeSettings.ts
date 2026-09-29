export const AGENT_BRIDGE_ENABLED_KEY = 'agentBridgeEnabled';

/** Off by default: the bridge only runs once the user opts in. */
export async function getAgentBridgeEnabled(): Promise<boolean> {
  const result = await browser.storage.local.get(AGENT_BRIDGE_ENABLED_KEY);
  return result[AGENT_BRIDGE_ENABLED_KEY] === true;
}

export async function setAgentBridgeEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [AGENT_BRIDGE_ENABLED_KEY]: enabled });
}

/** Native messaging is an optional permission, requested only when the user
 * turns the bridge on. Must be called straight from a click handler: the
 * permission prompt needs a user gesture. Returns false if it was refused. */
export async function enableAgentBridge(): Promise<boolean> {
  const granted = await browser.permissions.request({ permissions: ['nativeMessaging'] });
  if (!granted) return false;
  await setAgentBridgeEnabled(true);
  return true;
}
