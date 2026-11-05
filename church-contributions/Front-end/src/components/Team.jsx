import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const ROLE_LABELS = { OWNER: 'Treasurer', ASSISTANT: 'Assistant' };

function AddPerson({ onDone, notify }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
  }, [name, email, password]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError("Enter the person's name.");
    if (!email.includes('@')) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('The password needs at least 8 characters.');
    setBusy(true);
    try {
      const { user } = await api.addUser({ name: name.trim(), email: email.trim(), password, role: 'ASSISTANT' });
      notify(`Added ${user.name}. Give them the email and password so they can sign in.`);
      setName('');
      setEmail('');
      setPassword('');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="team-name">Name</label>
        <input id="team-name" type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="team-email">Email</label>
        <input
          id="team-email"
          type="email"
          autoComplete="off"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="team-password">Password for them to start with</label>
        <input
          id="team-password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          <span>Show the password</span>
        </label>
        <p className="hint">At least 8 characters. An assistant can record payments and see reports, but cannot change members, contribution types or accounts.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Adding…' : 'Add assistant'}
      </button>
    </form>
  );
}

function PersonRow({ person, isMe, onChanged, notify }) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
  }, [password]);

  async function toggle() {
    setBusy(true);
    try {
      await api.updateUser(person.id, { active: !person.active });
      notify(person.active ? `${person.name} can no longer sign in` : `${person.name} can sign in again`);
      onChanged();
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('The password needs at least 8 characters.');
    setBusy(true);
    try {
      await api.updateUser(person.id, { password });
      notify(`New password set for ${person.name}`);
      setResetting(false);
      setPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (resetting) {
    return (
      <li className="row is-editing">
        <form className="row-edit" onSubmit={savePassword} noValidate>
          <div className="field">
            <label htmlFor={`pw-${person.id}`}>New password for {person.name}</label>
            <input
              id={`pw-${person.id}`}
              type="text"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <p className="hint">At least 8 characters. Tell them the new password; their old one stops working.</p>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row-edit-actions">
            <button type="button" className="btn btn-quiet" onClick={() => { setResetting(false); setPassword(''); }} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Set password'}
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={person.active ? 'row' : 'row is-off'}>
      <div className="row-body">
        <div className="row-name">
          {person.name}
          {isMe && <span className="chip chip-paid">You</span>}
          {!person.active && <span className="chip chip-unpaid">Cannot sign in</span>}
        </div>
        <div className="row-line">{ROLE_LABELS[person.role] || person.role}</div>
        <div className="row-line">{person.email}</div>
      </div>
      <div className="row-actions">
        <button type="button" className="btn btn-link" onClick={() => setResetting(true)} aria-label={`Set a new password for ${person.name}`}>
          New password
        </button>
        {!isMe && (
          <button
            type="button"
            className="btn btn-link"
            onClick={toggle}
            disabled={busy}
            aria-label={`${person.active ? 'Stop' : 'Allow'} ${person.name} ${person.active ? 'signing in' : 'to sign in'}`}
          >
            {person.active ? 'Stop access' : 'Allow access'}
          </button>
        )}
      </div>
    </li>
  );
}

export default function Team({ me, notify }) {
  const [state, setState] = useState({ status: 'loading', users: [], error: '' });

  const load = useCallback(async () => {
    try {
      const { users } = await api.users();
      setState({ status: 'ready', users, error: '' });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <section className="sheet" aria-labelledby="team-add-title">
        <h2 id="team-add-title">Add assistant</h2>
        <AddPerson onDone={load} notify={notify} />
      </section>

      <section className="ledger" aria-labelledby="team-title">
        <h2 id="team-title">People who can sign in</h2>
        {state.status === 'loading' && <p className="muted">Loading…</p>}
        {state.status === 'error' && (
          <>
            <p className="error">{state.error}</p>
            <button type="button" className="btn btn-primary" onClick={load}>Try again</button>
          </>
        )}
        {state.users.length > 0 && (
          <ul className="rows">
            {state.users.map((u) => (
              <PersonRow key={u.id} person={u} isMe={u.id === me.id} onChanged={load} notify={notify} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
