import { createClerkClient } from '@clerk/backend';

export class AuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type AppUser = { id: string; display_name: string };

// All protected routes must authenticate before reading user or group data.
export async function authenticatedUser(request: Request, env: Env): Promise<AppUser> {
  const origin = new URL(request.url).origin;
  if (request.headers.get('Origin') && request.headers.get('Origin') !== origin) {
    throw new AuthError(403, 'Request origin is not allowed.');
  }
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length > 16384) {
    throw new AuthError(401, 'Sign in to continue.');
  }
  if (!env.CLERK_SECRET_KEY || !env.CLERK_PUBLISHABLE_KEY) {
    throw new AuthError(503, 'Sign-in is temporarily unavailable.');
  }
  const clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  });
  const state = await clerk.authenticateRequest(request, {
    authorizedParties: [origin],
    acceptsToken: 'session_token',
  });
  const auth = state.toAuth();
  if (!auth?.userId || !auth.sessionId) {
    throw new AuthError(401, 'Sign in to continue.');
  }

  // Fetch from Clerk, never trust a user ID, email, or name supplied by the browser.
  const profile = await clerk.users.getUser(auth.userId);
  if (!profile.emailAddresses.some(email => email.verification?.status === 'verified')) {
    throw new AuthError(403, 'Verify your email address to continue.');
  }
  // Email addresses are deliberately not used as public display-name fallbacks.
  const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim().slice(0, 100) || 'Member';
  const user = await env.DB.prepare(`
    INSERT INTO users (id, clerk_id, display_name) VALUES (?, ?, ?)
    ON CONFLICT(clerk_id) DO UPDATE SET display_name = excluded.display_name
    RETURNING id, display_name
  `).bind(crypto.randomUUID(), auth.userId, displayName).first<AppUser>();
  if (!user) throw new Error('User mapping failed');
  return user;
}
