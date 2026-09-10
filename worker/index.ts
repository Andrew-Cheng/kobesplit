import { groupsApi } from './groups';
import { isDashboardPath } from '../shared/navigation';
import { authenticatedUser, AuthError, AuthDependencyError } from './auth';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      const headers = {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      };
      if (/^\/api\/(groups(?:\/|$)|invitations\/)/.test(pathname)) {
        try {
          const result = await groupsApi(request, env);
          if (result) { for (const [key,value] of Object.entries(headers)) result.headers.set(key,value); return result; }
        } catch (error) {
          if (error instanceof AuthError) return Response.json({error:error.message},{status:error.status,headers});
          console.error({ event: 'group_request_failed', category: error instanceof AuthDependencyError ? error.category : 'unexpected' });
          if (error instanceof AuthDependencyError && error.category === 'clerk_rate_limit') {
            return Response.json({ error: 'Sign-in service is busy. Please try again shortly.' }, { status: 503, headers: { ...headers, 'Retry-After': String(error.retryAfter) } });
          }
          return Response.json({error:'Unable to complete the request. Please try again.'},{status:503,headers});
        }
      }
      if (pathname === '/api/me') {
        if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
        try {
          return Response.json({ user: await authenticatedUser(request, env) }, { headers });
        } catch (error) {
          if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status, headers });
          console.error({ event: 'authentication_failed', route: '/api/me', category: error instanceof AuthDependencyError ? error.category : 'unexpected' });
          if (error instanceof AuthDependencyError && error.category === 'clerk_rate_limit') {
            return Response.json({ error: 'Sign-in service is busy. Please try again shortly.' }, { status: 503, headers: { ...headers, 'Retry-After': String(error.retryAfter) } });
          }
          return Response.json({ error: 'Unable to load your account. Please try again.' }, { status: 503, headers });
        }
      }
      if (pathname !== '/api/health') {
        return Response.json({ error: 'Not found' }, { status: 404, headers });
      }
      if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed' }, {
          status: 405, headers: { ...headers, Allow: 'GET' },
        });
      }
      try {
        await env.DB.prepare('SELECT 1').first();
        return Response.json({ ok: true }, { headers });
      } catch {
        // Fixed fields only: never log raw errors, URLs, headers, or credentials.
        console.error({ event: 'database_health_failed', route: '/api/health' });
        return Response.json({ ok: false }, { status: 503, headers });
      }
    }
    try {
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set('Referrer-Policy', 'no-referrer');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      if (/^\/(s|invite)\//.test(pathname) || isDashboardPath(pathname)) {
        response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
        response.headers.set('Cache-Control', 'no-store');
      }
      return response;
    } catch {
      console.error({ event: 'asset_fetch_failed' });
      return new Response('Service temporarily unavailable', {
        status: 503,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
          'X-Robots-Tag': 'noindex',
        },
      });
    }
  },
} satisfies ExportedHandler<Env>;
