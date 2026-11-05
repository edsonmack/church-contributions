import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { dayOfTimestamp, formatDay, formatTZS, formatWhen } from '../format.js';

export default function RecentPayments({ refreshKey, onVoid }) {
  const [state, setState] = useState({ status: 'loading', payments: [], error: '' });

  useEffect(() => {
    let cancelled = false;
    api
      .recentPayments(10)
      .then(({ payments }) => {
        if (!cancelled) setState({ status: 'ready', payments, error: '' });
      })
      .catch((err) => {
        if (!cancelled) setState((s) => ({ ...s, status: 'error', error: err.message }));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <section className="ledger" aria-labelledby="recent-title">
      <h2 id="recent-title">Recent entries</h2>

      {state.status === 'loading' && <p className="muted">Loading…</p>}
      {state.status === 'error' && <p className="error">{state.error}</p>}
      {state.status === 'ready' && state.payments.length === 0 && (
        <p className="muted">No payments yet. The ones you save will appear here.</p>
      )}

      {state.payments.length > 0 && (
        <ul className="entries">
          {state.payments.map((p) => {
            const voided = Boolean(p.voidedAt);
            const received = dayOfTimestamp(p.createdAt) !== p.paymentDate;
            return (
              <li key={p.id} className={voided ? 'entry is-void' : 'entry'}>
                <div className="entry-body">
                  <div className="entry-name">{p.member.name}</div>
                  <div className="entry-line">
                    {p.contributionType.name}, {p.method === 'CASH' ? 'cash' : `mobile money ${p.mobileRef}`}
                  </div>
                  <div className="entry-line">
                    Entered by {p.recordedBy.name}, {formatWhen(p.createdAt)}
                  </div>
                  {received && <div className="entry-line">Received on {formatDay(p.paymentDate)}</div>}
                  {voided && (
                    <div className="entry-line">
                      Reason: {p.voidReason} (by {p.voidedBy ? p.voidedBy.name : 'unknown'})
                    </div>
                  )}
                </div>
                <div className="entry-side">
                  <div className="entry-amount">{formatTZS(p.amount)}</div>
                  {voided ? (
                    <span className="stamp">Voided</span>
                  ) : (
                    <button type="button" className="btn btn-link" onClick={() => onVoid(p)}>
                      Void
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
