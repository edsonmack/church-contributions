import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import QuickAdd from './QuickAdd.jsx';
import RecentPayments from './RecentPayments.jsx';
import VoidDialog from './VoidDialog.jsx';
import Dashboard from './Dashboard.jsx';
import Members from './Members.jsx';
import Reports from './Reports.jsx';
import Team from './Team.jsx';
import ContributionTypes from './ContributionTypes.jsx';

const ROLE_LABELS = { OWNER: 'Treasurer', ASSISTANT: 'Assistant', MEMBER: 'Member' };

const PAGES = [
  { id: 'add', label: 'Add payment', short: 'Add' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'reports', label: 'Reports' },
  { id: 'members', label: 'Members' },
  { id: 'types', label: 'Contribution types', short: 'Types' },
  // Reached from the header, and only for the treasurer, so the tab row stays short on a phone.
  { id: 'team', label: 'Team', ownerOnly: true, hidden: true },
];

// The address ends in #members or #types, so a refresh keeps you on the same screen.
function readPage(role) {
  const id = window.location.hash.replace('#', '');
  return PAGES.some((p) => p.id === id && (!p.ownerOnly || role === 'OWNER')) ? id : 'add';
}

export default function Shell({ user, organisation, onSignOut }) {
  const [page, setPage] = useState(() => readPage(user.role));
  const [prefill, setPrefill] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function goTo(id) {
    setPage(id);
    try {
      window.history.replaceState(null, '', `#${id}`);
    } catch {
      /* the address bar just will not update */
    }
  }
  const [voiding, setVoiding] = useState(null);
  const [toast, setToast] = useState(null);

  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  const notify = useCallback((message) => setToast({ message, id: Date.now() }), []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // From the dashboard: open Add payment already filled in for someone who still owes.
  function recordFor(details) {
    setPrefill(details);
    goTo('add');
  }

  async function confirmVoid(reason) {
    await api.voidPayment(voiding.id, reason);
    setVoiding(null);
    notify('Payment voided');
    refresh();
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">Contributions</span>
          <span className="brand-org">{organisation ? organisation.name : ''}</span>
        </div>
        <div className="who">
          <span className="who-name">{user.name}</span>
          <span className="who-role">{ROLE_LABELS[user.role] || user.role}</span>
          {user.role === 'OWNER' && (
            <button
              type="button"
              className="btn btn-quiet"
              aria-current={page === 'team' ? 'page' : undefined}
              onClick={() => goTo('team')}
            >
              Team
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        {PAGES.filter((p) => !p.hidden).map((p) => (
          <button
            key={p.id}
            type="button"
            className="tab"
            aria-current={page === p.id ? 'page' : undefined}
            aria-label={p.short ? p.label : undefined}
            onClick={() => goTo(p.id)}
          >
            {p.short ? (
              <>
                <span className="tab-full">{p.label}</span>
                <span className="tab-short" aria-hidden="true">{p.short}</span>
              </>
            ) : (
              p.label
            )}
          </button>
        ))}
      </nav>

      <main className="workspace">
        {page === 'add' && (
          <>
            <QuickAdd
              refreshKey={refreshKey}
              onSaved={refresh}
              notify={notify}
              prefill={prefill}
              onPrefillUsed={() => setPrefill(null)}
            />
            <RecentPayments refreshKey={refreshKey} onVoid={setVoiding} />
          </>
        )}
        {page === 'dashboard' && <Dashboard notify={notify} onRecord={recordFor} />}
        {page === 'reports' && <Reports notify={notify} />}
        {page === 'members' && <Members notify={notify} />}
        {page === 'team' && user.role === 'OWNER' && <Team me={user} notify={notify} />}
        {page === 'types' && <ContributionTypes role={user.role} notify={notify} />}
      </main>

      <VoidDialog payment={voiding} onCancel={() => setVoiding(null)} onConfirm={confirmVoid} />

      <div className="toast-region" role="status" aria-live="polite">
        {toast && <div className="toast" key={toast.id}>{toast.message}</div>}
      </div>
    </div>
  );
}
