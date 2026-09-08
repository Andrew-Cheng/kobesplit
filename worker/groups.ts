import { authenticatedIdentity, authenticatedUser, AuthError, type AppUser } from './auth';

const publicColumns = 'id, name, currency, creator_id, archived, created_at';
type Group = { id: string; name: string; currency: string; creator_id: string; archived: number; created_at: string };
type Invite = { id: string; group_id: string; email: string; expires_at: number; redeemed_by: string | null; revoked: number };
const now = () => Math.floor(Date.now() / 1000);
export async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new AuthError(415, 'Send JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(400, 'Send a JSON body.');
  let text = ''; let size = 0; const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new AuthError(413, 'Request is too large.'); }
    text += decoder.decode(chunk.value, {stream:true});
  }
  text += decoder.decode();
  try { const data = JSON.parse(text); if (data && typeof data === 'object' && !Array.isArray(data)) return data; } catch { /* validation below */ }
  throw new AuthError(400, 'Invalid JSON.');
}
async function group(db: D1Database, id: string) {
  const value = await db.prepare(`SELECT ${publicColumns} FROM groups WHERE id=?`).bind(id).first<Group>();
  if (!value) throw new AuthError(404, 'Group not found.');
  return value;
}
async function creator(db: D1Database, id: string, user: AppUser) {
  const g = await group(db, id);
  const active = await db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND status='active'").bind(id,user.id).first();
  if (g.creator_id !== user.id || !active) throw new AuthError(403, 'Only the group creator can manage invitations.');
  return g;
}
function guard(db: D1Database, sql: string, values: (string|number)[]) {
  const id = crypto.randomUUID();
  return [db.prepare(`INSERT INTO mutation_guards VALUES (?, (${sql}))`).bind(id,...values), db.prepare('DELETE FROM mutation_guards WHERE id=?').bind(id)];
}
function creatorGuard(db: D1Database, groupId: string, userId: string) {
  return guard(db, "SELECT EXISTS(SELECT 1 FROM groups g JOIN group_members m ON m.group_id=g.id WHERE g.id=? AND g.creator_id=? AND g.archived=0 AND m.user_id=? AND m.status='active')", [groupId,userId,userId]);
}
function audit(db: D1Database, groupId: string, userId: string, kind: string, entity: string, value: object) {
  return db.prepare('INSERT INTO audit_events(id,group_id,actor_id,kind,entity_id,current_json) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),groupId,userId,kind,entity,JSON.stringify(value));
}
async function limit(db: D1Database, userId: string) {
  try {
    await db.prepare(`INSERT INTO write_limits(user_id,window,hits) VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET
      window=excluded.window,hits=CASE WHEN write_limits.window=excluded.window THEN write_limits.hits+1 ELSE 1 END`).bind(userId,Math.floor(now()/60)).run();
  } catch { throw new AuthError(429, 'Too many changes. Try again in a minute.'); }
}
async function writeContext(request: Request, db: D1Database, userId: string, value: object) {
  const key = request.headers.get('Idempotency-Key');
  if (!key || !/^[a-zA-Z0-9-]{16,100}$/.test(key)) throw new AuthError(400, 'Provide a unique Idempotency-Key.');
  const fingerprint = await hash(`${request.method} ${new URL(request.url).pathname} ${JSON.stringify(value)}`);
  const previous = await db.prepare('SELECT fingerprint,resource_id FROM write_requests WHERE user_id=? AND request_key=?').bind(userId,key).first<{fingerprint:string;resource_id:string}>();
  if (previous && previous.fingerprint !== fingerprint) throw new AuthError(409,'This request key was already used for a different change.');
  return { previous, save: (id: string) => db.prepare('INSERT INTO write_requests VALUES(?,?,?,?)').bind(userId,key,fingerprint,id) };
}
export async function groupsApi(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!/^\/api\/(groups(?:\/|$)|invitations\/)/.test(path)) return null;
  const db = env.DB;
  const method = request.method;
  if (!['GET','POST'].includes(method)) throw new AuthError(405,'Method not allowed.');
  if (path === '/api/groups') {
    const user = await authenticatedUser(request,env);
    if (method === 'GET') {
      const rows = await db.prepare(`SELECT g.id,g.name,g.currency,g.archived,0 AS balance FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=? AND m.status='active' ORDER BY g.created_at DESC`).bind(user.id).all();
      return Response.json({groups:rows.results});
    }
    const data = await body(request);
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const currency = typeof data.currency === 'string' ? data.currency.toUpperCase() : '';
    if (!name || name.length>100 || !['USD','EUR','GBP','CAD','AUD','JPY','CHF','NZD','SGD','HKD','INR','CNY','KRW','MXN','BRL'].includes(currency)) throw new AuthError(400,'Choose a name (up to 100 characters) and a supported currency.');
    const write = await writeContext(request,db,user.id,{name,currency});
    if (write.previous) return Response.json({id:write.previous.resource_id});
    await limit(db,user.id);
    const id = crypto.randomUUID();
    try { await db.batch([
      write.save(id),
      db.prepare('INSERT INTO groups(id,name,currency,creator_id) VALUES(?,?,?,?)').bind(id,name,currency,user.id),
      db.prepare("INSERT INTO group_members(group_id,user_id,role) VALUES(?,?,'creator')").bind(id,user.id),
      audit(db,id,user.id,'group.created',id,{name,currency}),
    ]); } catch {
      const retry = await writeContext(request,db,user.id,{name,currency});
      if (retry.previous) return Response.json({id:retry.previous.resource_id});
      throw new AuthError(409,'Unable to create this group. Retry your request.');
    }
    return Response.json({id},{status:201});
  }
  const groupMatch = path.match(/^\/api\/groups\/([a-f0-9-]{36})(?:\/(settings|invites)(?:\/([a-f0-9-]{36})\/revoke)?)?$/);
  if (groupMatch) {
    const [,id,action,inviteId] = groupMatch;
    if (!action && method === 'GET') {
      const g = await group(db,id);
      const members = await db.prepare(`SELECT u.id,u.display_name,m.role,m.status FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY m.joined_at,u.id`).bind(id).all();
      return Response.json({group:g,members:members.results,expenses:[],repayments:[],debts:[]});
    }
    const user = await authenticatedUser(request,env);
    const g = await creator(db,id,user);
    if (action === 'settings' && method === 'GET') {
      const invites = await db.prepare('SELECT id,email,expires_at,revoked,redeemed_by IS NOT NULL AS accepted FROM invites WHERE group_id=? ORDER BY created_at DESC').bind(id).all();
      return Response.json({invites:invites.results});
    }
    if (action !== 'invites' || method !== 'POST') throw new AuthError(405,'Method not allowed.');
    if (g.archived) throw new AuthError(403,'Archived groups are read-only.');
    const data = await body(request);
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (!inviteId && (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new AuthError(400,'Enter a valid email address.');
    const value = inviteId ? {inviteId} : {email};
    const write = await writeContext(request,db,user.id,value);
    if (write.previous) return Response.json({id:write.previous.resource_id,replayed:true});
    await limit(db,user.id);
    const [check,clean] = creatorGuard(db,id,user.id);
    if (inviteId) {
      const existing = await db.prepare('SELECT id FROM invites WHERE id=? AND group_id=?').bind(inviteId,id).first();
      if (!existing) throw new AuthError(404,'Invitation not found.');
      try {
        await db.batch([check,write.save(inviteId),db.prepare('UPDATE invites SET revoked=1 WHERE id=? AND group_id=?').bind(inviteId,id),audit(db,id,user.id,'invite.revoked',inviteId,{}),clean]);
      } catch {
        const retry = await writeContext(request,db,user.id,value);
        if (retry.previous) return Response.json({id:retry.previous.resource_id,replayed:true});
        throw new AuthError(409,'The group changed. Reload before trying again.');
      }
      return Response.json({id:inviteId});
    }
    const token = crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
    const newId = crypto.randomUUID();
    try { await db.batch([check,write.save(newId),
      db.prepare('UPDATE invites SET revoked=1 WHERE group_id=? AND email=? AND revoked=0 AND redeemed_by IS NULL').bind(id,email),
      db.prepare('INSERT INTO invites(id,group_id,email,token_hash,expires_at) VALUES(?,?,?,?,?)').bind(newId,id,email,await hash(token),now()+7*86400),
      audit(db,id,user.id,'invite.created',newId,{}),clean,
    ]); } catch {
      const retry = await writeContext(request,db,user.id,value);
      if (retry.previous) return Response.json({id:retry.previous.resource_id,replayed:true});
      throw new AuthError(409,'The group changed. Reload before trying again.');
    }
    return Response.json({id:newId,link:`${new URL(request.url).origin}/invite/${token}`,expires_at:now()+7*86400},{status:201});
  }
  const invitation = path.match(/^\/api\/invitations\/([a-f0-9]{64})$/);
  if (invitation) {
    const invite = await db.prepare('SELECT id,group_id,email,expires_at,redeemed_by,revoked FROM invites WHERE token_hash=?').bind(await hash(invitation[1])).first<Invite>();
    if (!invite) throw new AuthError(404,'Invitation not found.');
    if (method === 'GET') {
      if (invite.revoked || invite.expires_at<=now() || invite.redeemed_by) throw new AuthError(410,'This invitation is no longer available. Ask the creator for a new one.');
      const g = await group(db,invite.group_id);
      return Response.json({name:g.name,group_id:g.id,expires_at:invite.expires_at,archived:Boolean(g.archived)});
    }
    const {user,verifiedEmails} = await authenticatedIdentity(request,env);
    if (!verifiedEmails.some(email=>email.toLowerCase()===invite.email)) throw new AuthError(403,'Sign in with the verified email address this invitation was sent to.');
    if (invite.redeemed_by === user.id && !invite.revoked) return Response.json({group_id:invite.group_id});
    if (invite.revoked || invite.expires_at<=now() || invite.redeemed_by) throw new AuthError(410,'This invitation is no longer available.');
    await limit(db,user.id);
    const [check,clean] = guard(db, 'SELECT EXISTS(SELECT 1 FROM invites i JOIN groups g ON g.id=i.group_id WHERE i.id=? AND i.revoked=0 AND i.redeemed_by IS NULL AND i.expires_at>? AND g.archived=0)',[invite.id,now()]);
    try { await db.batch([check,
      db.prepare('UPDATE invites SET redeemed_by=? WHERE id=?').bind(user.id,invite.id),
      db.prepare("INSERT INTO group_members(group_id,user_id,role) VALUES(?,?,'member') ON CONFLICT(group_id,user_id) DO UPDATE SET status='active'").bind(invite.group_id,user.id),
      audit(db,invite.group_id,user.id,'member.accepted',user.id,{invitation_id:invite.id}),clean,
    ]); } catch {
      const current = await db.prepare('SELECT redeemed_by FROM invites WHERE id=? AND revoked=0').bind(invite.id).first<{redeemed_by:string|null}>();
      if (current?.redeemed_by === user.id) return Response.json({group_id:invite.group_id});
      throw new AuthError(409,'This invitation changed or the group is archived. Ask the creator for help.');
    }
    return Response.json({group_id:invite.group_id});
  }
  throw new AuthError(404,'Not found.');
}
