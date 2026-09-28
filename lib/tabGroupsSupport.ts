/** Chrome has native tab groups (`tabGroups` + `tabs.group`); other browsers
 * (Firefox, at least as of writing) do not expose this API. Callers check
 * this instead of letting an unsupported call throw, so tab-group features
 * quietly do nothing on browsers that lack them rather than breaking save,
 * restore, or auto-group. Takes the browser API as a parameter so it can be
 * tested without needing to fake the global. */
export function hasTabGroupsSupport(api: typeof browser = browser): boolean {
  return typeof api?.tabGroups !== 'undefined' && typeof api?.tabs?.group === 'function';
}
