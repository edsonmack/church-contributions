import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { formatDay, formatLongDay, formatNumber, formatTZS, monthLabel, todayTZ } from '../format.js';
import { pickDefaultType, saveLastType } from '../prefs.js';
import MemberPicker from './MemberPicker.jsx';

const defaultAmountFor = (types, id) => {
  const type = types.find((t) => t.id === id);
  return type && type.defaultAmount ? String(type.defaultAmount) : '';
};

// prefill comes from the dashboard: { memberId, typeId, amount, date } for someone who still owes.
export default function QuickAdd({ refreshKey, onSaved, notify, prefill, onPrefillUsed }) {
  const [initial] = useState(prefill || null);
  const [boot, setBoot] = useState({ status: 'loading', error: '' });
  const [types, setTypes] = useState([]);
  const [members, setMembers] = useState([]);
  const [typeId, setTypeId] = useState('');
  const [member, setMember] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [mobileRef, setMobileRef] = useState('');
  const [date, setDate] = useState(todayTZ());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [monthly, setMonthly] = useState(null);
  const [focusSignal, setFocusSignal] = useState(0);

  const today = todayTZ();
  const effectiveDate = date || today;
  const month = effectiveDate.slice(0, 7);
  const selectedType = types.find((t) => t.id === typeId);
  const expected = selectedType ? selectedType.defaultAmount : null;

  const load = useCallback(async () => {
    setBoot({ status: 'loading', error: '' });
    try {
      const [t, m] = await Promise.all([api.contributionTypes(), api.members()]);
      const list = t.contributionTypes;
      setTypes(list);
      setMembers(m.members);
      const wanted = initial && list.some((x) => x.id === initial.typeId) ? initial.typeId : null;
      const first = wanted || pickDefaultType(list);
      setTypeId(first);
      setAmount(wanted && initial.amount ? String(initial.amount) : defaultAmountFor(list, first));
      if (initial) {
        if (initial.date) setDate(initial.date);
        const found = m.members.find((x) => x.id === initial.memberId);
        if (found) setMember(found);
      }
      setBoot({ status: 'ready', error: '' });
    } catch (err) {
      setBoot({ status: 'error', error: err.message });
    }
  }, [initial]);

  useEffect(() => {
    load();
  }, [load]);

  // The prefill has been used once; clear it so coming back later does not apply it again.
  useEffect(() => {
    if (boot.status === 'ready' && initial && onPrefillUsed) onPrefillUsed();
  }, [boot.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Who has paid so far this month, for the chosen type. Used for hints beside each name.
  useEffect(() => {
    if (!typeId || !expected || !/^\d{4}-\d{2}$/.test(month)) {
      setMonthly(null);
      return undefined;
    }
    let cancelled = false;
    api
      .monthly(typeId, month)
      .then((report) => {
        if (!cancelled) setMonthly(report);
      })
      .catch(() => {
        if (!cancelled) setMonthly(null);
      });
    return () => {
      cancelled = true;
    };
  }, [typeId, expected, month, refreshKey]);

  const statusMap = useMemo(
    () => new Map(((monthly && monthly.members) || []).map((row) => [row.memberId, row])),
    [monthly]
  );

  const statusFor = useCallback(
    (memberId) => {
      const row = statusMap.get(memberId);
      if (!row) return null;
      if (row.status === 'PAID') return { label: 'Paid', tone: 'paid' };
      if (row.status === 'PARTIAL') return { label: `Paid ${formatNumber(row.paid)}`, tone: 'partial' };
      return { label: 'Not paid', tone: 'unpaid' };
    },
    [statusMap]
  );

  function changeType(id) {
    setTypeId(id);
    setAmount(defaultAmountFor(types, id));
    saveLastType(id);
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!member) return setError('Choose a member.');
    const value = Number(amount);
    if (!value) return setError('Enter the amount.');
    if (method === 'MOBILE_MONEY' && mobileRef.trim().length < 4) {
      return setError('Enter the mobile money reference from the confirmation message.');
    }

    setSaving(true);
    try {
      const body = {
        memberId: member.id,
        contributionTypeId: typeId,
        amount: value,
        method,
        paymentDate: effectiveDate,
      };
      if (method === 'MOBILE_MONEY') body.mobileRef = mobileRef.trim();
      if (notes.trim()) body.notes = notes.trim();

      const { payment } = await api.createPayment(body);
      notify(`Saved ${formatTZS(payment.amount)} from ${payment.member.name}`);

      // Ready for the next person: keep the type, date and method, clear the rest.
      setMember(null);
      setAmount(defaultAmountFor(types, typeId));
      setMobileRef('');
      setNotes('');
      setFocusSignal((n) => n + 1);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (boot.status === 'loading') {
    return <section className="sheet"><p className="muted">Loading…</p></section>;
  }

  if (boot.status === 'error') {
    return (
      <section className="sheet">
        <p className="error">{boot.error}</p>
        <button type="button" className="btn btn-primary" onClick={load}>Try again</button>
      </section>
    );
  }

  if (types.length === 0 || members.length === 0) {
    return (
      <section className="sheet">
        <h2>Add payment</h2>
        <p>
          {types.length === 0 ? 'There are no contribution types yet. ' : ''}
          {members.length === 0 ? 'There are no members yet. ' : ''}
          Add them first, then you can record payments here.
        </p>
      </section>
    );
  }

  const row = member ? statusMap.get(member.id) : null;

  return (
    <section className="sheet" aria-labelledby="add-title">
      <h2 id="add-title">Add payment</h2>

      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="type">Contribution</label>
          <select id="type" value={typeId} onChange={(e) => changeType(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.defaultAmount ? ` (${formatTZS(t.defaultAmount)})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="member-input">Member</label>
          <MemberPicker
            members={members}
            value={member}
            onChange={setMember}
            statusFor={statusFor}
            focusSignal={focusSignal}
          />
          {row && row.status === 'UNPAID' && (
            <p className="hint">Has not paid for {monthLabel(effectiveDate)}.</p>
          )}
          {row && row.status === 'PARTIAL' && (
            <p className="hint">
              Paid {formatTZS(row.paid)} of {formatTZS(expected)} for {monthLabel(effectiveDate)}.
              Still owing {formatTZS(row.owing)}.{' '}
              <button type="button" className="btn btn-link inline" onClick={() => setAmount(String(row.owing))}>
                Fill in {formatNumber(row.owing)}
              </button>
            </p>
          )}
          {row && row.status === 'PAID' && (
            <p className="hint">Already paid in full for {monthLabel(effectiveDate)}.</p>
          )}
        </div>

        <div className="field">
          <label htmlFor="amount">Amount</label>
          <div className="amount">
            <span className="amount-unit" aria-hidden="true">TZS</span>
            <input
              id="amount"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={amount ? formatNumber(amount) : ''}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="0"
            />
          </div>
          {expected && <p className="hint">Usual amount: {formatTZS(expected)}</p>}
        </div>

        <fieldset className="field">
          <legend>Paid by</legend>
          <div className="segmented">
            <label>
              <input
                type="radio"
                name="method"
                value="CASH"
                checked={method === 'CASH'}
                onChange={() => setMethod('CASH')}
              />
              <span>Cash</span>
            </label>
            <label>
              <input
                type="radio"
                name="method"
                value="MOBILE_MONEY"
                checked={method === 'MOBILE_MONEY'}
                onChange={() => setMethod('MOBILE_MONEY')}
              />
              <span>Mobile money</span>
            </label>
          </div>
        </fieldset>

        {method === 'MOBILE_MONEY' && (
          <div className="field">
            <label htmlFor="mobile-ref">Reference from the message</label>
            <input
              id="mobile-ref"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              value={mobileRef}
              onChange={(e) => setMobileRef(e.target.value)}
              placeholder="For example: QK81X2LMNA"
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="date">Date received</label>
          <input
            id="date"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <p className="hint">
            {effectiveDate < today
              ? `Backdated: this will count for ${formatDay(effectiveDate)}.`
              : `Today, ${formatLongDay(today)}.`}
          </p>
        </div>

        <details className="notes">
          <summary>Add a note</summary>
          <textarea
            rows="2"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Note"
            maxLength={500}
          />
        </details>

        {error && <p className="error" role="alert">{error}</p>}

        <button className="btn btn-primary btn-block" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save payment'}
        </button>
      </form>
    </section>
  );
}
