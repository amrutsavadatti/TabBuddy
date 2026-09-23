import { useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { getAccentColor } from '@/lib/color';
import { isHttpUrl } from '@/lib/lazyTab';

function App() {
  const { url, title, favIconUrl } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const rawUrl = params.get('u') ?? '';
    return {
      url: isHttpUrl(rawUrl) ? rawUrl : '',
      title: params.get('t') ?? '',
      favIconUrl: params.get('f') ?? '',
    };
  }, []);

  const hostname = useMemo(() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'Unavailable';
    }
  }, [url]);

  const load = () => {
    if (url) window.location.replace(url);
  };

  useEffect(() => {
    document.title = title ? `${hostname} – ${title}` : hostname;
    if (isHttpUrl(favIconUrl)) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = favIconUrl;
      document.head.appendChild(link);
    }
    if (document.visibilityState === 'visible') load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const accent = getAccentColor(hostname);

  return (
    <div className="relative flex h-screen w-screen items-center justify-center p-6">
      <div className="pointer-events-none fixed inset-0 overflow-hidden bg-background">
        <div
          className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-[100px]"
          style={{ backgroundColor: accent }}
        />
      </div>
      <div className="relative flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card p-10 text-center shadow-2xl">
        {isHttpUrl(favIconUrl) ? (
          <img src={favIconUrl} alt="" className="h-14 w-14 rounded-xl" />
        ) : (
          <div className="h-14 w-14 rounded-xl bg-muted" />
        )}
        <p className="text-2xl font-semibold tracking-tight">{hostname}</p>
        {title && <p className="line-clamp-2 text-sm font-medium">{title}</p>}
        <p className="w-full break-all text-xs text-muted-foreground">{url}</p>
        <p className="text-xs text-muted-foreground">
          Not loaded yet to save memory. It opens when you switch to this tab.
        </p>
        <Button onClick={load} disabled={!url}>
          Load now
        </Button>
      </div>
    </div>
  );
}

export default App;
