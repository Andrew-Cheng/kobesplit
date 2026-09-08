import { env, exports } from 'cloudflare:workers';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { mockClerkUser, sessionToken, startClerkFixture, stopClerkFixture, uniqueClerkUser } from './clerk-fixture';
import { signInDestination } from '../shared/navigation';

beforeAll(startClerkFixture);
afterAll(stopClerkFixture);
const requestMe = (token?: string, extraHeaders: Record<string, string> = {}) => exports.default.fetch('https://example.com/api/me', { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders } });

describe('Clerk session boundary and D1 mapping', () => {
  it('rejects anonymous requests and cookie-only sessions', async () => {
    for (const response of [await requestMe(), await requestMe(undefined, { Cookie: '__session=untrusted' })]) {
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: 'Sign in to continue.' });
    }
  });
  it.each([
    ['expired', { exp: 1 }], ['wrong origin', { azp: 'https://attacker.test' }],
    ['not yet valid', { nbf: Math.floor(Date.now()/1000) + 600 }], ['pending session', { sts: 'pending' }],
  ])('rejects a %s token', async (_, claims) => {
    const response = await requestMe(await sessionToken(uniqueClerkUser(), claims as Record<string, unknown>));
    expect(response.status).toBe(401);
    await response.text();
  });
  it('rejects a forged signature', async () => {
    const token = await sessionToken(uniqueClerkUser());
    const parts = token.split('.'); parts[2] = 'invalid-signature';
    const response = await requestMe(parts.join('.'));
    expect(response.status).toBe(401); await response.text();
  });
  it('rejects mismatched HTTP origins before authentication', async () => {
    const response = await requestMe('untrusted', { Origin: 'https://attacker.test' });
    expect(response.status).toBe(403); await response.text();
  });
  it('requires a verified email', async () => {
    const sub = uniqueClerkUser(); mockClerkUser(sub, { verified: false });
    const response = await requestMe(await sessionToken(sub));
    expect(response.status).toBe(403); await response.text();
    expect(await env.DB.prepare('SELECT id FROM users WHERE clerk_id=?').bind(sub).first()).toBeNull();
  });
  it('rejects a banned account', async () => {
    const sub = uniqueClerkUser(); mockClerkUser(sub, { banned: true });
    const response = await requestMe(await sessionToken(sub));
    expect(response.status).toBe(403); await response.text();
  });
  it('maps concurrent requests to one stable user without exposing Clerk data', async () => {
    const sub = uniqueClerkUser(); mockClerkUser(sub);
    const token = await sessionToken(sub);
    const responses = await Promise.all([requestMe(token), requestMe(token), requestMe(token)]);
    const results = await Promise.all(responses.map(async response => {
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      return await response.json() as { user: { id: string; display_name: string } };
    }));
    expect(results[0]).toEqual({ user: { id: expect.any(String), display_name: 'Alex Rivera' } });
    expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE clerk_id=?').bind(sub).first('count')).toBe(1);
  });
  it('does not fall back to an email as the public name', async () => {
    const sub = uniqueClerkUser(); mockClerkUser(sub, { firstName: null, lastName: null });
    const response = await requestMe(await sessionToken(sub));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: expect.any(String), display_name: 'Member' } });
  });
  it('rejects unsupported methods', async () => {
    const response = await exports.default.fetch('https://example.com/api/me', { method: 'POST' });
    expect(response.status).toBe(405); await response.text();
  });
});

describe('sign-in return destination', () => {
  it.each(['/s/group-id', '/invite/one_time_token', '/invite/token/'])('preserves %s', path => expect(signInDestination(path)).toBe(path));
  it.each(['/', '/dashboard', '//attacker.test', '/\\attacker.test', 'https://attacker.test', '/?redirect_url=https://attacker.test'])('uses dashboard for %s', path => expect(signInDestination(path)).toBe('/dashboard'));
});

// Group settings preserve their destination through the same sign-in flow.
it('returns to group settings after sign-in', () => {
  expect(signInDestination('/s/random-group/settings')).toBe('/s/random-group/settings');
});
