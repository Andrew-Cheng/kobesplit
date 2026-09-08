export interface Env { DB: D1Database; ASSETS: Fetcher }
export default {
 async fetch(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith('/api/')) {
   const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
   if (pathname !== '/api/health') return Response.json({ error: 'Not found' }, { status: 404, headers });
   if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
   try {
    await env.DB.prepare('SELECT 1').first();
    return Response.json({ ok: true }, { headers });
   } catch {
    return Response.json({ ok: false }, { status: 503, headers });
   }
  }
  const asset = await env.ASSETS.fetch(request);
  const response = new Response(asset.body, asset);
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  if (/^\/(s|invite)\//.test(pathname)) {
   response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
   response.headers.set('Cache-Control', 'no-store');
  }
  return response;
 }
} satisfies ExportedHandler<Env>;
