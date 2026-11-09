import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { formatTZS, monthLabel } from '../format.js';
import AmountInput from './AmountInput.jsx';
import MonthField from './MonthField.jsx';

function AddType({ onDone, notify }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [startMonth, setStartMonth] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef(null);

  useEffect(() => {
    setError('');
  }, [name, amount, startMonth]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Enter a name, for example Monthly fee.');
    setBusy(true);
    try {
      const body = { name: name.trim() };
      if (amount) body.defaultAmount = Number(amount);
      if (startMonth) body.startMonth = startMonth;
      const { contributionType } = await api.addContributionType(body);
      notify(`Added ${contributionType.name}`);
      setName('');
      setAmount('');
      setStartMonth('');
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
        <label htmlFor="type-name">Name</label>
        <input
          id="type-name"
          ref={nameRef}
          type="text"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="For example: Monthly fee"
        />
      </div>
      <div className="field">
        <label htmlFor="type-amount">Usual amount in shillings (optional)</label>
        <AmountInput id="type-amount" value={amount} onChange={setAmount} />
        <p className="hint">Leave this empty when the amount changes each time, such as a free will offering.</p>
      </div>
      <div className="field">
        <label htmlFor="type-month">Month this contribution is for (optional)</label>
        <MonthField id="type-month" value={startMonth} onChange={setStartMonth} />
        <p className="hint">
          Choose a month when the contribution belongs to one month, such as ADA for August. Payments count for that
          month even if they arrive later. Leave it as Not tied to a month for a contribution that repeats every month.
        </p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Adding…' : 'Add contribution type'}
      </button>
    </form>
  );
}

function TypeRow({ type, canEdit, onChanged, notify }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(type.name);
  const [amount, setAmount] = useState(type.defaultAmount ? String(type.defaultAmount) : '');
  const [startMonth, setStartMonth] = useState(type.startMonth || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function startEdit() {
    setName(type.name);
    setAmount(type.defaultAmount ? String(type.defaultAmount) : '');
    setStartMonth(type.startMonth || '');
    setError('');
    setEditing(true);
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('The name cannot be empty.');
    setBusy(true);
    try {
      await api.updateContributionType(type.id, {
        name: name.trim(),
        defaultAmount: amount ? Number(amount) : null,
        startMonth: startMonth || null,
      });
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
      await api.updateContributionType(type.id, { active: !type.active });
      notify(type.active ? `${type.name} deactivated` : `${type.name} reactivated`);
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
            <label htmlFor={`tname-${type.id}`}>Name</label>
            <input id={`tname-${type.id}`} type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor={`tamount-${type.id}`}>Usual amount in shillings (optional)</label>
            <AmountInput id={`tamount-${type.id}`} value={amount} onChange={setAmount} />
          </div>
          <div className="field">
            <label htmlFor={`tmonth-${type.id}`}>Month this contribution is for (optional)</label>
            <MonthField id={`tmonth-${type.id}`} value={startMonth} onChange={setStartMonth} />
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
    <li className={type.active ? 'row' : 'row is-off'}>
      <div className="row-body">
        <div className="row-name">
          {type.name}
          {!type.active && <span className="chip chip-unpaid">Deactivated</span>}
        </div>
        <div className="row-line">{type.defaultAmount ? formatTZS(type.defaultAmount) : 'No usual amount'}</div>
        {type.startMonth && <div className="row-line">For {monthLabel(type.startMonth)}</div>}
      </div>
      {canEdit && (
        <div className="row-actions">
          <button type="button" className="btn btn-link" onClick={startEdit} aria-label={`Edit ${type.name}`}>
            Edit
          </button>
          <button type="button" className="btn btn-link" onClick={toggle} disabled={busy} aria-label={`${type.active ? 'Deactivate' : 'Reactivate'} ${type.name}`}>
            {type.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      )}
    </li>
  );
}

export default function ContributionTypes({ role, notify }) {
  const canEdit = role === 'OWNER';
  const [state, setState] = useState({ status: 'loading', types: [], error: '' });

  const load = useCallback(async () => {
    try {
      const { contributionTypes } = await api.allContributionTypes();
      setState({ status: 'ready', types: contributionTypes, error: '' });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <section className="sheet" aria-labelledby="add-type-title">
        <h2 id="add-type-title">Add contribution type</h2>
        {canEdit ? (
          <AddType onDone={load} notify={notify} />
        ) : (
          <p>Only the treasurer can add or change contribution types. You can still record payments for them.</p>
        )}
      </section>

      <section className="ledger" aria-labelledby="types-title">
        <h2 id="types-title">Contribution types</h2>

        {state.status === 'loading' && <p className="muted">Loading…</p>}
        {state.status === 'error' && (
          <>
            <p className="error">{state.error}</p>
            <button type="button" className="btn btn-primary" onClick={load}>Try again</button>
          </>
        )}
        {state.status === 'ready' && state.types.length === 0 && (
          <p className="muted">No contribution types yet. Add one, for example Monthly fee.</p>
        )}

        {state.types.length > 0 && (
          <ul className="rows">
            {state.types.map((t) => (
              <TypeRow key={t.id} type={t} canEdit={canEdit} onChanged={load} notify={notify} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
