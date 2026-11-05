const TZ = 'Africa/Dar_es_Salaam';

export const formatNumber = (n) => Number(n).toLocaleString('en-US');
export const formatTZS = (n) => `TZS ${formatNumber(n)}`;

// Today's date as YYYY-MM-DD in Tanzania, whatever the device's own timezone is.
export function todayTZ() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// "2026-11-04" becomes "November 2026"
export function monthLabel(dateString) {
  return new Date(`${dateString.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// shiftMonth("2026-11", -1) is "2026-10"
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

// lastDayOfMonth("2026-10") is "2026-10-31"
export function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// "2026-11-04" becomes "4 Nov"
export function formatDay(dateString) {
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

// "2026-11-05" becomes "Thursday 5 November"
export function formatLongDay(dateString) {
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

// A timestamp shown in Tanzania time, for example "4 Nov, 23:15"
export function formatWhen(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// The Tanzania calendar date of a timestamp, as YYYY-MM-DD
export function dayOfTimestamp(iso) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
