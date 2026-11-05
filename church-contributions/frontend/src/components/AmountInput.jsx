import { formatNumber } from '../format.js';

// A box for whole shillings. Shows 10,000 while storing the digits 10000.
export default function AmountInput({ id, value, onChange, placeholder = '0', label }) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={label}
      placeholder={placeholder}
      value={value ? formatNumber(value) : ''}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
    />
  );
}
