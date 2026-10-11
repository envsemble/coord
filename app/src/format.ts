// Dates: relative in lists, absolute in tooltips. Never raw ISO strings in the UI.
function parse(value: string) {
  return new Date(value.length === 10 ? value + 'T12:00:00' : value);
}
export function absoluteDate(value: string | null | undefined) {
  if (!value) return '';
  const date = parse(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, value.length === 10 ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
export function shortDate(value: string | null | undefined) {
  if (!value) return '';
  const date = parse(value);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function relativeDate(value: string | null | undefined, now = Date.now()) {
  if (!value) return '';
  const date = parse(value);
  if (Number.isNaN(date.getTime())) return '';
  if (value.length === 10) {
    // Calendar dates compare whole days.
    const today = new Date(now); today.setHours(12, 0, 0, 0);
    const days = Math.round((date.getTime() - today.getTime()) / 86400000);
    if (Math.abs(days) < 30) return relativeFormat.format(days, 'day');
    return 'on ' + shortDate(value);
  }
  const seconds = Math.round((date.getTime() - now) / 1000);
  const magnitude = Math.abs(seconds);
  if (magnitude < 45) return 'just now';
  if (magnitude < 3600) return relativeFormat.format(Math.round(seconds / 60), 'minute');
  if (magnitude < 86400) return relativeFormat.format(Math.round(seconds / 3600), 'hour');
  if (magnitude < 86400 * 30) return relativeFormat.format(Math.round(seconds / 86400), 'day');
  return 'on ' + shortDate(value);
}
export function bytes(value: number) { return value < 1024 ? value + ' B' : value < 1048576 ? Math.round(value / 1024) + ' KB' : (value / 1048576).toFixed(1) + ' MB'; }
export function workNumber(id: string) { return id.replace('work-', '#'); }
export function plural(count: number, word: string, many = word + 's') { return count + ' ' + (count === 1 ? word : many); }
/** A count compactly, for tokens: 950, 12.9K, 1.2M. */
export function compactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
/** Active time: "45 min", "3 h 20 min", "2 d 4 h". */
export function duration(milliseconds: number) {
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 1) return milliseconds > 0 ? '< 1 min' : '0 min';
  if (minutes < 60) return minutes + ' min';
  const hours = Math.floor(minutes / 60), restMinutes = minutes % 60;
  if (hours < 48) return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
  const days = Math.floor(hours / 24), restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
