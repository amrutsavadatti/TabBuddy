/** Query parameters that only say where a visitor came from. */
const TRACKING_PARAM = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|igshid|mc_cid|mc_eid|_hsenc|_hsmi|vero_id)$/i;

/** A key that is the same for two addresses that show the same page: `www.`,
 * http vs https, a trailing slash, tracking parameters and the order of the
 * other parameters don't matter. A #fragment is ignored unless it looks like
 * a route (#/inbox, #!/page), which single-page apps use to tell pages apart.
 * Returns null for anything that is not a web address. The key is for
 * comparing, not for opening. */
export function pageKey(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const port = url.port ? `:${url.port}` : '';
  const path = url.pathname.replace(/\/+$/, '');
  const params = [...url.searchParams.entries()]
    .filter(([name]) => !TRACKING_PARAM.test(name))
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
  const route = /^#[/!]/.test(url.hash) ? url.hash : '';
  return `${host}${port}${path}${query}${route}`;
}
