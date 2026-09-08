import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, vi } from 'vitest';
import worker from '../worker';

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(`https://example.com${path}`, init);

describe('Worker in the Cloudflare runtime', () => {
  it('checks a real local D1 binding and prevents response caching', async () => {
    expect(await env.DB.prepare('SELECT 1 AS connected').first('connected')).toBe(1);
    const response = await fetchWorker('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns JSON instead of the SPA for unknown API routes', async () => {
    const response = await fetchWorker('/api/missing');
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('rejects unsupported health methods', async () => {
    const response = await fetchWorker('/api/health', { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    await response.text();
  });

  it.each(['/s/random-group', '/invite/random-token'])('serves built SPA assets with privacy headers at %s', async path => {
    const response = await fetchWorker(path, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).toMatch(/\/assets\/index-[^" ]+\.js/);
  });

  it('serves the real compiled JavaScript asset', async () => {
    const page = await fetchWorker('/', { headers: { 'Sec-Fetch-Mode': 'navigate' } });
    const html = await page.text();
    const path = html.match(/src="([^"]+\.js)"/)?.[1];
    expect(path).toBeDefined();
    const response = await env.ASSETS.fetch(`https://example.com${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/javascript/);
    expect((await response.text()).length).toBeGreaterThan(0);
  });

  it('logs a safe database error without exposing the original exception', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
      throw new Error('sensitive database details');
    });
    const response = await worker.fetch(new Request('https://example.com/api/health'), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
    expect(log.mock.calls).toEqual([[{ event: 'database_health_failed', route: '/api/health' }]]);
  });

  it('handles asset failures without logging invitation tokens or raw errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(env.ASSETS, 'fetch').mockRejectedValue(new Error('private upstream error'));
    const response = await worker.fetch(new Request('https://example.com/invite/secret-token'), env);
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(await response.text()).toBe('Service temporarily unavailable');
    expect(log.mock.calls).toEqual([[{ event: 'asset_fetch_failed' }]]);
  });
});
