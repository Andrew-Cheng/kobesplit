import { useAuth, SignInButton } from '@clerk/react';
import { useEffect, useState } from 'react';
import { signInDestination } from '../shared/navigation';

type User = { id: string; display_name: string };
export function SignIn({ className = 'button', children = 'Sign in' }: { className?: string; children?: React.ReactNode }) {
  const destination = signInDestination(window.location.pathname);
  return <SignInButton mode="modal" forceRedirectUrl={destination} signUpForceRedirectUrl={destination}>
    <button type="button" className={className}>{children}</button>
  </SignInButton>;
}

export function Dashboard() {
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const [state, setState] = useState<{ user?: User; error?: string; owner?: string }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;
    const controller = new AbortController();
    setState({ owner: userId });
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('Please sign in again.');
        const response = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store', signal: controller.signal,
        });
        const data = await response.json() as { user?: User; error?: string };
        if (!response.ok || !data.user) throw new Error(data.error || 'Unable to load your account.');
        if (!controller.signal.aborted) setState({ user: data.user, owner: userId });
      } catch (error) {
        if (!controller.signal.aborted) setState({ owner: userId, error: error instanceof Error ? error.message : 'Unable to load your account.' });
      }
    })();
    return () => controller.abort();
  }, [isLoaded, isSignedIn, userId, getToken, attempt]);
  if (!isLoaded) return <section className="dashboard" aria-live="polite"><p>Loading your account…</p></section>;
  if (!isSignedIn) return <section className="dashboard"><p className="eyebrow">YOUR GROUPS</p><h1>A place for<br/><em>your people.</em></h1><p className="lead">Sign in to keep track of your shared expenses.</p><SignIn/></section>;
  if (state.owner !== userId || (!state.user && !state.error)) return <section className="dashboard" aria-live="polite"><p>Loading your account…</p></section>;
  if (state.error) return <section className="dashboard"><p role="alert">{state.error}</p><button className="button" onClick={() => setAttempt(n => n + 1)}>Try again</button></section>;
  return <section className="dashboard"><p className="eyebrow">YOUR GROUPS</p><h1>Welcome,<br/><em>{state.user!.display_name}.</em></h1><p className="lead">Your account is ready. Your shared groups will appear here.</p><div className="empty-state"><span aria-hidden="true">↗</span><h2>Good things start with a group.</h2><p>Group creation is coming soon. Come back for your next dinner, trip, or shared adventure.</p></div></section>;
}
