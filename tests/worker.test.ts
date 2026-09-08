import { describe, it, expect, vi } from 'vitest';
import worker, { type Env } from '../worker';
function env(dbFails=false) {
 return {DB:{prepare:vi.fn(()=>({first:dbFails?vi.fn().mockRejectedValue(new Error('private database info')):vi.fn().mockResolvedValue({1:1})}))},ASSETS:{fetch:vi.fn().mockResolvedValue(new Response('<html>App</html>',{headers:{'Content-Type':'text/html'}}))}} as unknown as Env;
}
describe('Worker foundation',()=>{
 it('checks the database and prevents health response caching',async()=>{
  const res=await worker.fetch(new Request('http://localhost/api/health'),env());
  expect(res.status).toBe(200);expect(await res.json()).toEqual({ok:true});expect(res.headers.get('Cache-Control')).toBe('no-store');
 });
 it('reports database failures without leaking details',async()=>{
  const res=await worker.fetch(new Request('http://localhost/api/health'),env(true));expect(res.status).toBe(503);expect(await res.json()).toEqual({ok:false});
 });
 it('does not serve the SPA for unknown API routes',async()=>{
  const res=await worker.fetch(new Request('http://localhost/api/missing'),env());expect(res.status).toBe(404);expect(await res.json()).toEqual({error:'Not found'});
 });
 it('rejects unsupported health methods',async()=>{
  const res=await worker.fetch(new Request('http://localhost/api/health',{method:'POST'}),env());expect(res.status).toBe(405);expect(res.headers.get('Allow')).toBe('GET');
 });
 it.each(['/s/random-group','/invite/random-token'])('adds privacy headers to %s',async path=>{
  const res=await worker.fetch(new Request(`http://localhost${path}`),env());expect(res.headers.get('X-Robots-Tag')).toContain('noindex');expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');expect(res.headers.get('Cache-Control')).toBe('no-store');expect(await res.text()).toContain('App');
 });
});
