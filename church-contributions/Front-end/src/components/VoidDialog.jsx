import { useEffect, useRef, useState } from 'react';
import { formatTZS } from '../format.js';

export default function VoidDialog({ payment, onCancel, onConfirm }) {
  const dialogRef = useRef(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (payment && !dialog.open) {
      setReason('');
      setError('');
      setBusy(false);
      dialog.showModal();
    } else if (!payment && dialog.open) {
      dialog.close();
    }
  }, [payment]);

  async function submit(e) {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError('Write a short reason, at least 3 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="void-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      {payment && (
        <form onSubmit={submit}>
          <h2 id="void-title">Void this payment?</h2>
          <p>
            {formatTZS(payment.amount)} from {payment.member.name} for {payment.contributionType.name}.
            It stays in the records, marked as voided, and no longer counts in totals.
          </p>
          <div className="field">
            <label htmlFor="void-reason">Reason</label>
            <textarea
              id="void-reason"
              rows="2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: entered for the wrong person"
              autoFocus
            />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
              Keep payment
            </button>
            <button type="submit" className="btn btn-danger" disabled={busy}>
              {busy ? 'Voiding…' : 'Void payment'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
