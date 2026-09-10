import { env, exports } from 'cloudflare:workers';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { network, mockClerkUser, sessionToken, startClerkFixture, stopClerkFixture, uniqueClerkUser } from './clerk-fixture';
import worker from '../worker';
import { http, HttpResponse } from 'msw';
import { isDashboardPath, signInDestination } from '../shared/navigation';

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
  it('does not update unchanged names, but keeps the ID when a name changes', async () => {
    const sub = uniqueClerkUser(); mockClerkUser(sub);
    const token = await sessionToken(sub);
    const original = await (await requestMe(token)).json();
    const trigger = `no_unchanged_${sub}`;
    await env.DB.exec(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON users WHEN OLD.clerk_id='${sub}' AND OLD.display_name=NEW.display_name BEGIN SELECT RAISE(ABORT, 'Unchanged profile was written'); END;`);
    try {
      const response = await requestMe(token);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(original);
      mockClerkUser(sub, { firstName: 'Updated' });
      const updated = await requestMe(token);
      expect(updated.status).toBe(200);
      expect(await updated.json()).toEqual({ user: { ...(original as {user: object}).user, display_name: 'Updated Rivera' } });
    } finally { await env.DB.exec(`DROP TRIGGER ${trigger}`); }
  });
  it('preserves an astral character at the display-name boundary', async () => {
    const sub = uniqueClerkUser();
    const name = 'a'.repeat(99) + '😀' + 'z';
    mockClerkUser(sub, { firstName: name, lastName: null });
    const response = await requestMe(await sessionToken(sub));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: expect.any(String), display_name: 'a'.repeat(99) + '😀' } });
  });
  it.each([[429, 'clerk_rate_limit'], [500, 'clerk_profile']] as const)('categorizes Clerk HTTP %s without exposing error details', async (status, category) => {
    const sub = uniqueClerkUser();
    network.use(http.get(`https://api.clerk.com/v1/users/${sub}`, () => HttpResponse.json({ errors: [{ code: 'fixture_error', message: 'private upstream details' }] }, { status, headers: { 'Retry-After': '17' } })));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await requestMe(await sessionToken(sub));
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe(status === 429 ? '17' : null);
    expect(await response.text()).not.toContain('private upstream details');
    expect(log.mock.calls).toEqual([[{ event: 'authentication_failed', route: '/api/me', category }]]);
  });
  it('categorizes D1 failures separately without logging database details', async () => {
    const sub = uniqueClerkUser(); mockClerkUser(sub);
    const token = await sessionToken(sub);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => { throw new Error('private database details'); });
    const response = await worker.fetch(new Request('https://example.com/api/me', { headers: { Authorization: `Bearer ${token}` } }), env);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private database details');
    expect(log.mock.calls).toEqual([[{ event: 'authentication_failed', route: '/api/me', category: 'database' }]]);
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

describe('dashboard routing', () => {
  it.each(['/dashboard', '/dashboard/', '/dashboard//'])('recognizes %s', path => expect(isDashboardPath(path)).toBe(true));
  it.each(['/dashboard-other', '/dashboard/settings', '/'])('does not treat %s as the dashboard', path => expect(isDashboardPath(path)).toBe(false));
});
