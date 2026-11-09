import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatTZS, monthLabel, shiftMonth, todayTZ } from '../format.js';

const METHODS = [
  { key: 'CASH', label: 'Cash' },
  { key: 'MOBILE_MONEY', label: 'Mobile money' },
];

// A name, an amount, and a bar showing its share of the largest amount in the list.
function BarRow({ label, total, count, max }) {
  const width = max > 0 ? Math.round((total / max) * 100) : 0;
  return (
    <li className="bar-row">
      <div className="bar-head">
        <span className="bar-label">{label}</span>
        <span className="bar-amount">{formatTZS(total)}</span>
      </div>
      <div className="bar-track" aria-hidden="true">
        <span style={{ width: `${width}%` }} />
      </div>
      <div className="bar-count">
        {count} {count === 1 ? 'payment' : 'payments'}
      </div>
    </li>
  );
}

export default function Reports({ notify }) {
  const thisMonth = todayTZ().slice(0, 7);
  const thisYear = thisMonth.slice(0, 4);
  const [mode, setMode] = useState('month');
  const [month, setMonth] = useState(thisMonth);
  const [year, setYear] = useState(thisYear);
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const period = mode === 'month' ? { month } : { year };

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    api
      .summary(mode === 'month' ? { month } : { year })
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: '' });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', data: null, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [mode, month, year, reloadKey]);

  async function exportFile() {
    setExporting(true);
    try {
      const name = await api.exportExcel(period);
      notify(`Downloaded ${name}`);
    } catch (err) {
      notify(err.message);
    } finally {
      setExporting(false);
    }
  }

  const data = state.data;
  const typeMax = data ? Math.max(0, ...data.byContributionType.map((t) => t.total)) : 0;
  const monthMax = data && data.byMonth ? Math.max(0, ...data.byMonth.map((m) => m.total)) : 0;
  const label = mode === 'month' ? monthLabel(month) : year;
  const atLatest = mode === 'month' ? month >= thisMonth : year >= thisYear;

  function step(delta) {
    if (mode === 'month') setMonth(shiftMonth(month, delta));
    else setYear(String(Number(year) + delta));
  }

  return (
    <>
      <section className="sheet" aria-labelledby="rep-title">
        <h2 id="rep-title">Reports</h2>

        <fieldset className="field">
          <legend>Show</legend>
          <div className="segmented">
            <label>
              <input type="radio" name="mode" checked={mode === 'month'} onChange={() => setMode('month')} />
              <span>One month</span>
            </label>
            <label>
              <input type="radio" name="mode" checked={mode === 'year'} onChange={() => setMode('year')} />
              <span>Whole year</span>
            </label>
          </div>
        </fieldset>

        <div className="month-nav">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => step(-1)}
            aria-label={mode === 'month' ? 'Previous month' : 'Previous year'}
          >
            Previous
          </button>
          <div className="month-label" aria-live="polite">{label}</div>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => step(1)}
            disabled={atLatest}
            aria-label={mode === 'month' ? 'Next month' : 'Next year'}
          >
            Next
          </button>
        </div>

        <p className="hint">
          Each contribution counts in the month it is for, even if the money arrived later. A contribution with no
          month counts by the date it was received.
        </p>

        {state.status === 'error' && (
          <>
            <p className="error">{state.error}</p>
            <button type="button" className="btn btn-primary" onClick={() => setReloadKey((n) => n + 1)}>
              Try again
            </button>
          </>
        )}

        {data && (
          <div className={state.status === 'loading' ? 'tally is-loading' : 'tally'}>
            <dl className="tally-lines">
              <div className="is-total">
                <dt>Total collected</dt>
                <dd>{formatTZS(data.totalCollected)}</dd>
              </div>
              <div>
                <dt>Payments</dt>
                <dd>{data.paymentCount}</dd>
              </div>
            </dl>
            {data.voided.count > 0 && (
              <p className="hint">
                {data.voided.count} voided {data.voided.count === 1 ? 'payment' : 'payments'} (
                {formatTZS(data.voided.total)}) not counted.
              </p>
            )}
            <button type="button" className="btn btn-primary btn-block" onClick={exportFile} disabled={exporting}>
              {exporting ? 'Preparing…' : 'Download Excel file'}
            </button>
            <p className="hint">
              Includes a summary and every payment{mode === 'month' ? ', and who has paid or still owes' : ''}.
            </p>
          </div>
        )}
      </section>

      {data && (
        <section className="ledger" aria-labelledby="by-type-title">
          <h2 id="by-type-title">By contribution</h2>
          {data.byContributionType.length === 0 ? (
            <p className="muted">No payments were received in {label}.</p>
          ) : (
            <ul className="bars">
              {data.byContributionType.map((t) => (
                <BarRow key={t.contributionTypeId} label={t.name} total={t.total} count={t.count} max={typeMax} />
              ))}
            </ul>
          )}

          <h2 className="report-gap">By payment method</h2>
          <ul className="bars">
            {METHODS.map((m) => (
              <BarRow
                key={m.key}
                label={m.label}
                total={data.byMethod[m.key].total}
                count={data.byMethod[m.key].count}
                max={Math.max(data.byMethod.CASH.total, data.byMethod.MOBILE_MONEY.total)}
              />
            ))}
          </ul>

          {data.byMonth && (
            <>
              <h2 className="report-gap">By month</h2>
              <ul className="bars">
                {data.byMonth.map((m) => (
                  <BarRow
                    key={m.month}
                    label={monthLabel(m.month).split(' ')[0]}
                    total={m.total}
                    count={m.count}
                    max={monthMax}
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
