// Remembers which contribution type was used last, so the next screen opens on it.

const LAST_TYPE_KEY = 'cc_last_type';

export function readLastType() {
  try {
    return window.localStorage.getItem(LAST_TYPE_KEY);
  } catch {
    return null;
  }
}

export function saveLastType(id) {
  try {
    window.localStorage.setItem(LAST_TYPE_KEY, id);
  } catch {
    /* not important */
  }
}

// The last type used, else one called "monthly", else the first in the list.
export function pickDefaultType(types) {
  const saved = readLastType();
  if (saved && types.some((t) => t.id === saved)) return saved;
  const monthly = types.find((t) => /month/i.test(t.name));
  return (monthly || types[0] || {}).id || '';
}
