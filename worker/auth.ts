import { createClerkClient } from '@clerk/backend';

export class AuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class AuthDependencyError extends Error {
  constructor(public category: 'token_verification' | 'clerk_profile' | 'clerk_rate_limit' | 'database', public retryAfter = 10) {
    super('Authentication dependency failed');
  }
}

export type AppUser = { id: string; display_name: string };
export type Identity = { user: AppUser; verifiedEmails: string[] };

export async function authenticatedUser(request: Request, env: Env): Promise<AppUser> {
  return (await authenticatedIdentity(request, env)).user;
}

// All protected routes must authenticate before reading user or group data.
export async function authenticatedIdentity(request: Request, env: Env): Promise<Identity> {
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
  }).catch(() => { throw new AuthDependencyError('token_verification'); });
  const auth = state.toAuth();
  if (!auth?.userId || !auth.sessionId) {
    throw new AuthError(401, 'Sign in to continue.');
  }

  // Fetch from Clerk, never trust a user ID, email, or name supplied by the browser.
  const profile = await clerk.users.getUser(auth.userId).catch(error => {
    const rateLimited = typeof error === 'object' && error !== null && error.status === 429;
    const retryAfter = rateLimited && typeof error.retryAfter === 'number' && Number.isFinite(error.retryAfter) && error.retryAfter >= 0 ? Math.ceil(error.retryAfter) : 10;
    throw new AuthDependencyError(rateLimited ? 'clerk_rate_limit' : 'clerk_profile', retryAfter);
  });
  if (profile.banned || profile.locked) throw new AuthError(403, 'This account is unavailable.');
  const verifiedEmails = profile.emailAddresses.filter(email => email.verification?.status === 'verified').map(email => email.emailAddress.toLowerCase());
  if (!verifiedEmails.length) {
    throw new AuthError(403, 'Verify your email address to continue.');
  }
  // Email addresses are deliberately not used as public display-name fallbacks.
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  const displayName = [...name].slice(0, 100).join('') || 'Member';
  try {
    const user = await env.DB.prepare(`
    INSERT INTO users (id, clerk_id, display_name) VALUES (?, ?, ?)
    ON CONFLICT(clerk_id) DO UPDATE SET display_name = excluded.display_name
    WHERE users.display_name <> excluded.display_name
    RETURNING id, display_name
  `).bind(crypto.randomUUID(), auth.userId, displayName).first<AppUser>();
    // A no-op conflict returns no row; read the existing mapping without writing it.
    const mapped = user ?? await env.DB.prepare('SELECT id, display_name FROM users WHERE clerk_id=?').bind(auth.userId).first<AppUser>();
    if (!mapped) throw new Error('User mapping failed');
    return { user: mapped, verifiedEmails };
  } catch {
    throw new AuthDependencyError('database');
  }
}
