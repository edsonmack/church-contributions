// Small input helpers shared by the routes.

const MAX_AMOUNT = 1_000_000_000; // whole TZS; stays inside the database's integer range

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

// Accepts 0712 345 678, +255712345678, 0712-345-678 and returns it without spaces or dashes.
// Returns null when it does not look like a phone number.
function normalisePhone(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\s\-().]/g, '');
  return /^\+?\d{9,15}$/.test(s) ? s : null;
}

// Amounts are whole shillings. Accepts 10000 or "10000".
// null or "" means "no amount". Returns { ok, value }.
function parseAmount(v) {
  if (v === null || v === '') return { ok: true, value: null };
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  if (!Number.isInteger(n) || n < 1 || n > MAX_AMOUNT) return { ok: false };
  return { ok: true, value: n };
}

// Today's date as YYYY-MM-DD in the organisation's timezone (Tanzania by default).
// The server may run in UTC, so "today" must not come from the server clock alone.
function todayInZone(timeZone = 'Africa/Dar_es_Salaam') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Accepts only a real calendar date written YYYY-MM-DD. Returns a Date at midnight UTC, or null.
function parseDateOnly(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null; // rejects 2026-02-31
  return d;
}

// A month written YYYY-MM, for example "2026-08". Empty or null means "not tied to a month".
function parseMonth(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return { ok: false };
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) return { ok: false };
  return { ok: true, value };
}

module.exports = { MAX_AMOUNT, clean, normalisePhone, parseAmount, parseMonth, todayInZone, parseDateOnly };
