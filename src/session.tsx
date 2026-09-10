import { SignInButton } from '@clerk/react';
import { signInDestination } from '../shared/navigation';

export function SignIn({ className = 'button', children = 'Sign in' }: { className?: string; children?: React.ReactNode }) {
  const destination = signInDestination(window.location.pathname);
  return <SignInButton mode="modal" forceRedirectUrl={destination} signUpForceRedirectUrl={destination}>
    <button type="button" className={className}>{children}</button>
  </SignInButton>;
}
