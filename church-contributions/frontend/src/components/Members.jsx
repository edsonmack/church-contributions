import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';

// One member per line: "Name, phone". A phone number is optional. Pasting from Excel works too.
function parseList(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = '', phone = ''] = line.split(/\t|,/).map((part) => part.trim());
      return phone ? { name, phone } : { name };
    });
}

function AddMember({ onDone, notify }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef(null);

  // An old error should disappear as soon as the person starts correcting the form.
  useEffect(() => {
    setError('');
  }, [name, phone]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError("Enter the member's name.");
    setBusy(true);
    try {
      const body = { name: name.trim() };
      if (phone.trim()) body.phone = phone.trim();
      const { member } = await api.addMember(body);
      notify(`Added ${member.name}`);
      setName('');
      setPhone('');
      onDone();
      if (nameRef.current) nameRef.current.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="new-name">Name</label>
        <input
          id="new-name"
          ref={nameRef}
          type="text"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="new-phone">Phone number (optional)</label>
        <input
          id="new-phone"
          type="text"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0712 345 678"
        />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Adding…' : 'Add member'}
      </button>
    </form>
  );
}

function AddMany({ onDone, notify }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState([]);
  const parsed = useMemo(() => parseList(text), [text]);

  useEffect(() => {
    setError('');
    setProblems([]);
  }, [text]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setProblems([]);
    if (parsed.length === 0) return setError('Type or paste at least one member.');
    setBusy(true);
    try {
      const { imported } = await api.addMembers(parsed);
      notify(`Added ${imported} ${imported === 1 ? 'member' : 'members'}`);
      setText('');
      onDone();
    } catch (err) {
      setError(err.message);
      setProblems((err.data && err.data.rows) || []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="notes">
      <summary>Add many at once</summary>
      <form onSubmit={submit} noValidate>
        <p className="help">
          One member per line, written as name, then a comma, then the phone number. The phone number is
          optional. You can also paste two columns from Excel.
        </p>
        <textarea
          rows="6"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Members to add, one per line"
          placeholder={'Mary Joseph, 0754 111 222\nPeter Kimaro, 0765333444\nGrace Lauwo'}
        />
        {error && <p className="error" role="alert">{error}</p>}
        {problems.length > 0 && (
          <ul className="problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || parsed.length === 0}>
          {busy ? 'Adding…' : parsed.length ? `Add ${parsed.length} ${parsed.length === 1 ? 'member' : 'members'}` : 'Add members'}
        </button>
      </form>
    </details>
  );
}

function MemberRow({ member, onChanged, notify }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name);
  const [phone, setPhone] = useState(member.phone || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function startEdit() {
    setName(member.name);
    setPhone(member.phone || '');
    setError('');
    setEditing(true);
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('The name cannot be empty.');
    setBusy(true);
    try {
      await api.updateMember(member.id, { name: name.trim(), phone: phone.trim() });
      notify(`Saved changes to ${name.trim()}`);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    setBusy(true);
    try {
      await api.updateMember(member.id, { active: !member.active });
      notify(member.active ? `${member.name} deactivated` : `${member.name} reactivated`);
      onChanged();
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="row is-editing">
        <form className="row-edit" onSubmit={save} noValidate>
          <div className="field">
            <label htmlFor={`name-${member.id}`}>Name</label>
            <input id={`name-${member.id}`} type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor={`phone-${member.id}`}>Phone number</label>
            <input
              id={`phone-${member.id}`}
              type="text"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row-edit-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={member.active ? 'row' : 'row is-off'}>
      <div className="row-body">
        <div className="row-name">
          {member.name}
          {!member.active && <span className="chip chip-unpaid">Deactivated</span>}
        </div>
        <div className="row-line">{member.phone || 'No phone number'}</div>
      </div>
      <div className="row-actions">
        <button type="button" className="btn btn-link" onClick={startEdit} aria-label={`Edit ${member.name}`}>
          Edit
        </button>
        <button type="button" className="btn btn-link" onClick={toggle} disabled={busy} aria-label={`${member.active ? 'Deactivate' : 'Reactivate'} ${member.name}`}>
          {member.active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>
    </li>
  );
}

export default function Members({ notify }) {
  const [state, setState] = useState({ status: 'loading', members: [], error: '' });
  const [search, setSearch] = useState('');
  const [showOff, setShowOff] = useState(false);

  const load = useCallback(async () => {
    try {
      const { members } = await api.allMembers();
      setState({ status: 'ready', members, error: '' });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeCount = state.members.filter((m) => m.active).length;
  const offCount = state.members.length - activeCount;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.members.filter(
      (m) =>
        (showOff || m.active) &&
        (!q || m.name.toLowerCase().includes(q) || (m.phone || '').includes(q))
    );
  }, [state.members, search, showOff]);

  return (
    <>
      <section className="sheet" aria-labelledby="add-member-title">
        <h2 id="add-member-title">Add member</h2>
        <AddMember onDone={load} notify={notify} />
        <hr className="divider" />
        <AddMany onDone={load} notify={notify} />
      </section>

      <section className="ledger" aria-labelledby="members-title">
        <h2 id="members-title">Members</h2>

        {state.status === 'loading' && <p className="muted">Loading…</p>}
        {state.status === 'error' && (
          <>
            <p className="error">{state.error}</p>
            <button type="button" className="btn btn-primary" onClick={load}>Try again</button>
          </>
        )}

        {state.status === 'ready' && (
          <>
            <p className="muted">
              {activeCount} active{offCount > 0 ? `, ${offCount} deactivated` : ''}
            </p>

            <div className="toolbar">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or phone"
                aria-label="Search members"
              />
              {offCount > 0 && (
                <label className="check">
                  <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
                  Show deactivated members
                </label>
              )}
            </div>

            {state.members.length === 0 && (
              <p className="muted">No members yet. Add the first one, or paste your whole list under "Add many at once".</p>
            )}
            {state.members.length > 0 && shown.length === 0 && <p className="muted">No member matches your search.</p>}

            <ul className="rows">
              {shown.map((m) => (
                <MemberRow key={m.id} member={m} onChanged={load} notify={notify} />
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
