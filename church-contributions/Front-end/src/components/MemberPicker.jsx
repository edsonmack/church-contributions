import { useEffect, useId, useMemo, useRef, useState } from 'react';

// Type a name (or part of a phone number) and pick from the matches. No scrolling through a long list.
export default function MemberPicker({ members, value, onChange, statusFor, focusSignal }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (focusSignal > 0 && inputRef.current) inputRef.current.focus();
  }, [focusSignal]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members.slice(0, 8);
    return members
      .filter((m) => m.name.toLowerCase().includes(q) || (m.phone || '').includes(q))
      .sort(
        (a, b) =>
          Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) ||
          a.name.localeCompare(b.name)
      )
      .slice(0, 8);
  }, [members, query]);

  function pick(member) {
    onChange(member);
    setQuery('');
    setOpen(false);
    setActive(0);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  if (value) {
    return (
      <div className="picked">
        <div>
          <div className="picked-name">{value.name}</div>
          {value.phone && <div className="muted small">{value.phone}</div>}
        </div>
        <button type="button" className="btn btn-link" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="picker">
      <input
        ref={inputRef}
        id="member-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder="Start typing a name"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="options" id={listId} role="listbox">
          {matches.length === 0 && <li className="option-empty">No member matches “{query.trim()}”.</li>}
          {matches.map((m, i) => {
            const status = statusFor(m.id);
            return (
              <li
                key={m.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'option is-active' : 'option'}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the input so the click is not lost
                  pick(m);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span>{m.name}</span>
                {status && <span className={`chip chip-${status.tone}`}>{status.label}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
