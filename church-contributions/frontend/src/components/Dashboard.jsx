import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { copyText } from '../clipboard.js';
import { formatTZS, lastDayOfMonth, monthLabel, shiftMonth, todayTZ } from '../format.js';
import { pickDefaultType, saveLastType } from '../prefs.js';

const GROUPS = [
  { status: 'UNPAID', title: 'Not paid' },
  { status: 'PARTIAL', title: 'Part paid' },
  { status: 'PAID', title: 'Paid' },
];

function detail(m) {
  if (m.status === 'PAID') return `Paid ${formatTZS(m.paid)}`;
  if (m.status === 'PARTIAL') return `Paid ${formatTZS(m.paid)}, owes ${formatTZS(m.owing)}`;
  return `Owes ${formatTZS(m.owing)}`;
}

// A plain-text list to paste into WhatsApp or a message.
function reminderText(report) {
  const { contributionType: type, members } = report;
  const lines = [`${type.name}, ${monthLabel(report.month)} (${formatTZS(type.defaultAmount)} each)`];
  const unpaid = members.filter((m) => m.status === 'UNPAID');
  const part = members.filter((m) => m.status === 'PARTIAL');
  if (unpaid.length) {
    lines.push('', 'Not paid:');
    unpaid.forEach((m) => lines.push(`- ${m.name}`));
  }
  if (part.length) {
    lines.push('', 'Part paid:');
    part.forEach((m) => lines.push(`- ${m.name}, still owes ${formatTZS(m.owing)}`));
  }
  return lines.join('\n');
}

export default function Dashboard({ notify, onRecord }) {
  const thisMonth = todayTZ().slice(0, 7);
  const [types, setTypes] = useState({ status: 'loading', list: [], error: '' });
  const [typeId, setTypeId] = useState('');
  const [month, setMonth] = useState(thisMonth);
  const [report, setReport] = useState({ status: 'idle', data: null, error: '' });
  const [reloadKey, setReloadKey] = useState(0);

  // Only types with a usual amount can be compared against what people paid.
  useEffect(() => {
    let cancelled = false;
    api
      .contributionTypes()
      .then(({ contributionTypes }) => {
        if (cancelled) return;
        const list = contributionTypes.filter((t) => t.defaultAmount);
        setTypes({ status: 'ready', list, error: '' });
        setTypeId(pickDefaultType(list));
      })
      .catch((err) => {
        if (!cancelled) setTypes({ status: 'error', list: [], error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!typeId) return undefined;
    let cancelled = false;
    setReport((r) => ({ ...r, status: 'loading', error: '' }));
    api
      .monthly(typeId, month)
      .then((data) => {
        if (!cancelled) setReport({ status: 'ready', data, error: '' });
      })
      .catch((err) => {
        if (!cancelled) setReport({ status: 'error', data: null, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [typeId, month, reloadKey]);

  function changeType(id) {
    setTypeId(id);
    saveLastType(id);
  }

  async function copyReminder() {
    const ok = await copyText(reminderText(report.data));
    notify(ok ? 'List copied. You can paste it into a message.' : 'Could not copy the list.');
  }

  function record(m) {
    const tied = (types.list.find((x) => x.id === typeId) || {}).startMonth || null;
    onRecord({
      memberId: m.memberId,
      typeId,
      amount: m.owing,
      // A contribution tied to a month counts for that month whenever it is paid, so use today.
      // Otherwise, for an earlier month, backdate to its last day so the payment counts for that month.
      date: tied || month === thisMonth ? todayTZ() : lastDayOfMonth(month),
    });
  }

  if (types.status === 'loading') {
    return <section className="sheet"><p className="muted">Loading…</p></section>;
  }

  if (types.status === 'error') {
    return (
      <section className="sheet">
        <p className="error">{types.error}</p>
        <button type="button" className="btn btn-primary" onClick={() => setReloadKey((n) => n + 1)}>
          Try again
        </button>
      </section>
    );
  }

  if (types.list.length === 0) {
    return (
      <section className="sheet">
        <h2>Dashboard</h2>
        <p>
          The dashboard compares what people paid with the usual amount. Add a contribution type with a usual
          amount, such as Monthly fee, and it will show here.
        </p>
      </section>
    );
  }

  // A contribution tied to a month always shows that month, so there is nothing to step through.
  const tied = (types.list.find((x) => x.id === typeId) || {}).startMonth || null;
  const shownMonth = tied || month;

  const data = report.data;
  const t = data ? data.totals : null;
  const extra = t ? Math.max(t.collected - (t.expected - t.outstanding), 0) : 0;
  const percent = t && t.expected ? Math.min(100, Math.round(((t.collected - extra) / t.expected) * 100)) : 0;

  return (
    <>
      <section className="sheet" aria-labelledby="dash-title">
        <h2 id="dash-title">Dashboard</h2>

        <div className="field">
          <label htmlFor="dash-type">Contribution</label>
          <select id="dash-type" value={typeId} onChange={(e) => changeType(e.target.value)}>
            {types.list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({formatTZS(x.defaultAmount)})
              </option>
            ))}
          </select>
        </div>

        {tied ? (
          <div className="month-fixed">
            <div className="month-label" aria-live="polite">{monthLabel(tied)}</div>
            <p className="hint">This contribution is for {monthLabel(tied)}. Payments count for it whenever they were received.</p>
          </div>
        ) : (
          <div className="month-nav">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setMonth(shiftMonth(month, -1))}
              aria-label="Previous month"
            >
              Previous
            </button>
            <div className="month-label" aria-live="polite">{monthLabel(shownMonth)}</div>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={month >= thisMonth}
              aria-label="Next month"
            >
              Next
            </button>
          </div>
        )}

        {report.status === 'error' && (
          <>
            <p className="error">{report.error}</p>
            <button type="button" className="btn btn-primary" onClick={() => setReloadKey((n) => n + 1)}>
              Try again
            </button>
          </>
        )}

        {t && (
          <div className={report.status === 'loading' ? 'tally is-loading' : 'tally'}>
            <div className="meter" role="img" aria-label={`${percent}% of the expected amount collected`}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <p className="meter-text">{percent}% of the expected amount collected</p>

            <dl className="tally-lines">
              <div>
                <dt>Expected</dt>
                <dd>{formatTZS(t.expected)}</dd>
              </div>
              <div>
                <dt>Collected</dt>
                <dd>{formatTZS(t.collected)}</dd>
              </div>
              <div className="is-total">
                <dt>Still owing</dt>
                <dd>{formatTZS(t.outstanding)}</dd>
              </div>
            </dl>
            {extra > 0 && (
              <p className="hint">Collected includes {formatTZS(extra)} paid above the usual amount.</p>
            )}

            <div className="counts">
              <span className="chip chip-paid">{t.paidCount} paid</span>
              <span className="chip chip-partial">{t.partialCount} part paid</span>
              <span className="chip chip-unpaid">{t.unpaidCount} not paid</span>
            </div>

            {t.unpaidCount + t.partialCount > 0 && (
              <button type="button" className="btn btn-quiet btn-block" onClick={copyReminder}>
                Copy list of who still owes
              </button>
            )}
          </div>
        )}
      </section>

      <section className="ledger" aria-labelledby="status-title">
        <h2 id="status-title">Payment status</h2>

        {report.status === 'loading' && !data && <p className="muted">Loading…</p>}
        {data && data.members.length === 0 && (
          <p className="muted">There are no active members yet. Add them on the Members tab.</p>
        )}

        {data &&
          GROUPS.map((g) => {
            const rows = data.members.filter((m) => m.status === g.status);
            if (rows.length === 0) return null;
            return (
              <div key={g.status}>
                <h3 className="group-title">
                  {g.title} ({rows.length})
                </h3>
                <ul className="rows">
                  {rows.map((m) => (
                    <li key={m.memberId} className="row">
                      <div className="row-body">
                        <div className="row-name">{m.name}</div>
                        <div className="row-line">{detail(m)}</div>
                        {m.phone && <div className="row-line">{m.phone}</div>}
                      </div>
                      <div className="row-actions">
                        {m.status !== 'PAID' && m.phone && (
                          <a className="btn btn-link" href={`tel:${m.phone}`} aria-label={`Call ${m.name}`}>
                            Call
                          </a>
                        )}
                        {m.owing > 0 && (
                          <button
                            type="button"
                            className="btn btn-link"
                            onClick={() => record(m)}
                            aria-label={`Add payment for ${m.name}`}
                          >
                            Add payment
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
      </section>
    </>
  );
}
