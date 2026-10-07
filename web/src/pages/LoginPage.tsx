import { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
} from 'firebase/auth';
import { auth, usingEmulators } from '../firebase';
import { useAuth } from '../auth/AuthProvider';
import { Button, Field, Input } from '../components/ui';

const EMAIL_KEY = 'gear:signInEmail';
const RETURN_KEY = 'gear:returnTo';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src="/icon.svg" alt="" className="size-14" />
          <div>
            <h1 className="text-xl font-semibold">Calleva Gear</h1>
            <p className="text-sm text-stone-600">Equipment, inspections and repairs</p>
          </div>
        </div>
        <div className="card space-y-4 p-6">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage({ returnTo }: { returnTo: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const linkSignIn = isSignInWithEmailLink(auth, window.location.href);

  useEffect(() => {
    if (returnTo && returnTo !== '/' && !returnTo.startsWith('/login')) sessionStorage.setItem(RETURN_KEY, returnTo);
  }, [returnTo]);

  // Completing an emailed sign-in link.
  useEffect(() => {
    if (!linkSignIn) return;
    const saved = localStorage.getItem(EMAIL_KEY);
    if (saved) void finishLink(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finishLink(addr: string) {
    setBusy(true);
    try {
      await signInWithEmailLink(auth, addr.trim(), window.location.href);
      localStorage.removeItem(EMAIL_KEY);
      window.history.replaceState(null, '', sessionStorage.getItem(RETURN_KEY) ?? '/');
      sessionStorage.removeItem(RETURN_KEY);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      const back = sessionStorage.getItem(RETURN_KEY);
      if (back) {
        sessionStorage.removeItem(RETURN_KEY);
        window.history.replaceState(null, '', back);
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setError((e as Error).message);
    }
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await sendSignInLinkToEmail(auth, email.trim(), { url: `${window.location.origin}/login`, handleCodeInApp: true });
      localStorage.setItem(EMAIL_KEY, email.trim());
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (linkSignIn) {
    return (
      <Shell>
        <p className="text-sm text-stone-700">Confirm the email address you requested the sign-in link for.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void finishLink(email);
          }}
          className="space-y-3"
        >
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </Shell>
    );
  }

  return (
    <Shell>
      <Button variant="primary" className="w-full" onClick={google}>
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <path fill="#fff" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.4 3-7.3Z" />
          <path fill="#fff" opacity=".8" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
          <path fill="#fff" opacity=".6" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9.1L6.4 14Z" />
          <path fill="#fff" opacity=".9" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6Z" />
        </svg>
        Sign in with Google
      </Button>
      <p className="text-center text-xs text-stone-500">Calleva staff: use your calleva.org account.</p>
      <div className="flex items-center gap-3 text-xs text-stone-400">
        <span className="h-px flex-1 bg-stone-200" />
        or
        <span className="h-px flex-1 bg-stone-200" />
      </div>
      {sent ? (
        <p className="rounded-md bg-brand-50 p-3 text-sm text-brand-900">
          Check <b>{email}</b> for a sign-in link. You can close this tab.
        </p>
      ) : (
        <form onSubmit={sendLink} className="space-y-3">
          <Field label="Invited with another email?">
            <Input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>
            Email me a sign-in link
          </Button>
        </form>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {usingEmulators && <DevSignIn />}
    </Shell>
  );
}

/** Local emulator only: sign in as a seeded demo user (password "password"). */
function DevSignIn() {
  const [email, setEmail] = useState('admin@calleva.org');
  return (
    <form
      className="space-y-2 rounded-md border border-dashed border-amber-400 bg-amber-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        signInWithEmailAndPassword(auth, email, 'password').catch((err) => alert(err.message));
      }}
    >
      <p className="text-xs font-medium text-amber-900">Emulator: sign in as a demo user</p>
      <div className="flex gap-2">
        <select className="input" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Demo user">
          {['admin', 'manager', 'staff', 'tech'].map((u) => (
            <option key={u} value={`${u}@calleva.org`}>
              {u}@calleva.org
            </option>
          ))}
        </select>
        <Button type="submit">Go</Button>
      </div>
    </form>
  );
}

export function DeniedPage({ message, email }: { message: string; email: string | null }) {
  const { signOut } = useAuth();
  return (
    <Shell>
      <h2 className="font-semibold">No access</h2>
      <p className="text-sm text-stone-700">{message}</p>
      {email && <p className="text-xs text-stone-500">Signed in as {email}</p>}
      <Button className="w-full" onClick={() => signOut()}>
        Sign out
      </Button>
    </Shell>
  );
}
