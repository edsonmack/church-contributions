const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// A month and year picker. The value is "YYYY-MM", or "" when no month is chosen.
export default function MonthField({ id, value, onChange }) {
  const thisYear = new Date().getFullYear();
  const month = value ? value.slice(5) : '';
  const year = value ? value.slice(0, 4) : '';

  const years = [];
  for (let y = thisYear - 2; y <= thisYear + 2; y += 1) years.push(String(y));
  if (year && !years.includes(year)) years.push(year);
  years.sort();

  function changeMonth(m) {
    if (!m) return onChange('');
    return onChange(`${year || thisYear}-${m}`);
  }

  function changeYear(y) {
    if (month) onChange(`${y}-${month}`);
  }

  return (
    <div className="month-field">
      <select id={id} value={month} onChange={(e) => changeMonth(e.target.value)} aria-label="Month">
        <option value="">Not tied to a month</option>
        {MONTHS.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, '0')}>
            {name}
          </option>
        ))}
      </select>
      <select value={year || String(thisYear)} onChange={(e) => changeYear(e.target.value)} disabled={!month} aria-label="Year">
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
