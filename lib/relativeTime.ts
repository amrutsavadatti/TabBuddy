export function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return plural(diffMinutes, 'minute');
  if (diffHours < 24) return plural(diffHours, 'hour');
  if (diffDays < 30) return plural(diffDays, 'day');
  if (diffMonths < 12) return plural(diffMonths, 'month');
  return plural(diffYears, 'year');
}
