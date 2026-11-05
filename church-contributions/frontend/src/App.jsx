import { useCallback, useEffect, useState } from 'react';
import { api, session } from './api.js';
import Login from './components/Login.jsx';
import Shell from './components/Shell.jsx';

export default function App() {
  const [state, setState] = useState({
    status: session.token ? 'loading' : 'out',
    user: null,
    organisation: null,
    notice: '',
    error: '',
  });

  const signOut = useCallback((notice = '') => {
    session.clear();
    setState({ status: 'out', user: null, organisation: null, notice, error: '' });
  }, []);

  useEffect(() => {
    session.onUnauthorized = () => signOut('Your session expired. Please sign in again.');
    return () => {
      session.onUnauthorized = null;
    };
  }, [signOut]);

  const restore = useCallback(() => {
    if (!session.token) return;
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    api
      .me()
      .then(({ user, organisation }) =>
        setState({ status: 'in', user, organisation, notice: '', error: '' })
      )
      .catch((err) => {
        if (err.status === 401) return; // the session handler already signed out
        setState((s) => ({ ...s, status: 'error', error: err.message }));
      });
  }, []);

  useEffect(() => {
    restore();
  }, [restore]);

  async function handleLogin(email, password) {
    const { token } = await api.login(email, password);
    session.set(token);
    const { user, organisation } = await api.me();
    setState({ status: 'in', user, organisation, notice: '', error: '' });
  }

  if (state.status === 'loading') {
    return <div className="splash" role="status">Loading…</div>;
  }

  if (state.status === 'error') {
    return (
      <div className="splash">
        <p>{state.error}</p>
        <button type="button" className="btn btn-primary" onClick={restore}>Try again</button>
        <button type="button" className="btn btn-quiet" onClick={() => signOut()}>Sign out</button>
      </div>
    );
  }

  if (state.status === 'out') {
    return <Login onLogin={handleLogin} notice={state.notice} />;
  }

  return <Shell user={state.user} organisation={state.organisation} onSignOut={() => signOut()} />;
}
