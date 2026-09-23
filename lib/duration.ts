export type DurationUnit = 'minutes' | 'hours' | 'days';

export const DURATION_UNITS: { id: DurationUnit; label: string; minutes: number }[] = [
  { id: 'minutes', label: 'Minutes', minutes: 1 },
  { id: 'hours', label: 'Hours', minutes: 60 },
  { id: 'days', label: 'Days', minutes: 1440 },
];

export function toMinutes(value: number, unit: DurationUnit): number {
  return value * DURATION_UNITS.find((u) => u.id === unit)!.minutes;
}

/** Picks the largest unit that divides the duration evenly, so 90 min stays
 * "90 minutes" but 120 min becomes "2 hours". */
export function fromMinutes(totalMinutes: number): { value: number; unit: DurationUnit } {
  for (const unit of [...DURATION_UNITS].reverse()) {
    if (totalMinutes >= unit.minutes && totalMinutes % unit.minutes === 0) {
      return { value: totalMinutes / unit.minutes, unit: unit.id };
    }
  }
  return { value: totalMinutes, unit: 'minutes' };
}

export function formatDurationShort(totalMinutes: number): string {
  const { value, unit } = fromMinutes(totalMinutes);
  return `${value}${unit === 'minutes' ? 'm' : unit === 'hours' ? 'h' : 'd'}`;
}
