import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Role, UserProfile, WithId } from '@gear/shared';
import { auth, db, functions } from '../firebase';

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'activating'; user: User }
  | { status: 'denied'; user: User; message: string }
  | { status: 'ready'; user: User; profile: UserProfile & WithId };

interface AuthContextValue {
  state: AuthState;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const activateAccount = httpsCallable<void, { status: string; role: Role }>(functions, 'activateAccount');

function profileProblem(p: UserProfile): string | null {
  if (!p.active) return 'Your account has been deactivated. Ask an admin if you still need access.';
  if (p.expiresAt && p.expiresAt.toMillis() <= Date.now())
    return 'Your access has expired. Ask an admin to extend it.';
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (user === undefined) return;
    if (user === null) {
      setState({ status: 'signedOut' });
      return;
    }
    setState({ status: 'activating', user });
    let activation: Promise<unknown> | null = null;
    let activationError: string | null = null;

    // Creates the profile on first sign-in; afterwards it just records the
    // sign-in time and re-checks that access hasn't ended.
    const activate = () => {
      if (!navigator.onLine || activation) return activation;
      activation = activateAccount().catch((e: { message?: string }) => {
        activationError = e.message ?? 'Could not activate your account.';
        setState((s) =>
          s.status === 'ready' ? s : { status: 'denied', user, message: activationError! },
        );
      });
      return activation;
    };
    activate();

    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (!snap.exists()) {
          if (!navigator.onLine && snap.metadata.fromCache)
            setState({ status: 'denied', user, message: 'Connect to the internet once to finish setting up your account.' });
          else if (activationError) setState({ status: 'denied', user, message: activationError });
          return;
        }
        const profile = { id: snap.id, ...(snap.data() as UserProfile) };
        const problem = profileProblem(profile);
        setState(problem ? { status: 'denied', user, message: problem } : { status: 'ready', user, profile });
      },
      (err) => setState({ status: 'denied', user, message: err.message }),
    );
    return unsub;
  }, [user]);

  const value = useMemo<AuthContextValue>(() => ({ state, signOut: () => signOut(auth) }), [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** The signed-in, activated user. Only use inside routes guarded by RequireAuth. */
export function useMe() {
  const { state } = useAuth();
  if (state.status !== 'ready') throw new Error('useMe called before sign-in completed');
  const p = state.profile;
  return {
    profile: p,
    uid: p.id,
    isAdmin: p.role === 'admin',
    isManager: p.role === 'admin' || p.role === 'manager',
  };
}
