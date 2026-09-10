import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { createPasskey, getPasskey } from '../lib/webauthn.js';

/** Sign-in / bootstrap / invite-redemption screen. Ported 1:1 in behavior
 * from the vanilla auth flow: if an `?invite=` token is present in the URL
 * it takes priority, otherwise bootstrap (no accounts yet) or a plain
 * login screen. */
export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('loading'); // loading | login | bootstrap | invite
  const [inviteToken, setInviteToken] = useState(null);
  const [canRegisterHint, setCanRegisterHint] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(location.search);
      const token = params.get('invite');
      if (token) {
        const res = await fetch(`/api/invites/${encodeURIComponent(token)}`);
        if (cancelled) return;
        if (res.ok) {
          setInviteToken(token);
          setMode('invite');
          return;
        }
        setError('That invite link is invalid, used, or expired.');
        setMode('login');
        return;
      }
      const me = await fetch('/api/auth/me').then((r) => r.json());
      if (cancelled) return;
      if (me.bootstrap_available) {
        setMode('bootstrap');
      } else {
        setCanRegisterHint(true);
        setMode('login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin() {
    setError('');
    setBusy(true);
    try {
      const { options, challengeId } = await api('/api/auth/login/options', { method: 'POST', body: JSON.stringify({}) });
      const response = await getPasskey(options);
      await api('/api/auth/login/verify', { method: 'POST', body: JSON.stringify({ challengeId, response }) });
      onAuthed();
    } catch (err) {
      setError(err.message || 'Sign-in failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleBootstrap() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter your name.');
    setError('');
    setBusy(true);
    try {
      const { options, challengeId } = await api('/api/auth/register/options', {
        method: 'POST',
        body: JSON.stringify({ displayName: trimmed }),
      });
      const response = await createPasskey(options);
      await api('/api/auth/register/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, response, bootstrap: true }),
      });
      history.replaceState(null, '', '/');
      onAuthed();
    } catch (err) {
      setError(err.message || 'Could not create your passkey. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleInvite() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter your name.');
    setError('');
    setBusy(true);
    try {
      const { options, challengeId } = await api('/api/auth/register/options', {
        method: 'POST',
        body: JSON.stringify({ displayName: trimmed, inviteToken }),
      });
      const response = await createPasskey(options);
      await api('/api/auth/register/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, response, inviteToken }),
      });
      history.replaceState(null, '', '/');
      onAuthed();
    } catch (err) {
      setError(err.message || 'Could not create your passkey. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen" id="authScreen">
      <div className="auth-card">
        <h1>Todo</h1>
        <div id="authBody">
          {mode === 'loading' && null}
          {mode === 'login' && (
            <>
              <p className="lead">Sign in with the passkey on this device.</p>
              <button className="btn primary" type="button" disabled={busy} onClick={handleLogin}>
                Sign in
              </button>
              {canRegisterHint && (
                <p className="lead" style={{ marginTop: 16 }}>
                  Have an invite link? Open it directly to create an account.
                </p>
              )}
            </>
          )}
          {mode === 'bootstrap' && (
            <>
              <p className="lead">No account exists yet — you&apos;ll be the first, and become the admin.</p>
              <label>
                Your name
                <input
                  maxLength={60}
                  placeholder="e.g. Ryan"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button className="btn primary" type="button" disabled={busy} onClick={handleBootstrap}>
                Create passkey
              </button>
            </>
          )}
          {mode === 'invite' && (
            <>
              <p className="lead">You&apos;ve been invited to this household&apos;s todo board.</p>
              <label>
                Your name
                <input
                  maxLength={60}
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button className="btn primary" type="button" disabled={busy} onClick={handleInvite}>
                Create passkey
              </button>
            </>
          )}
        </div>
        <p className="form-error" hidden={!error}>{error}</p>
      </div>
    </div>
  );
}
