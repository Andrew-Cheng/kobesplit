import { env } from 'cloudflare:workers';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { groupsApi, hash } from '../worker/groups';
import { authenticatedUser } from '../worker/auth';
import { startClerkFixture, stopClerkFixture, mockClerkUser, uniqueClerkUser, sessionToken } from './clerk-fixture';

let user: {id:string;display_name:string};
let email:string;
let clerkId:string;
let token:string;
beforeAll(startClerkFixture);
afterAll(stopClerkFixture);
beforeEach(async()=>{
  clerkId=uniqueClerkUser(); email=`${clerkId}@example.test`;
  mockClerkUser(clerkId,{email,firstName:'Taylor',lastName:null}); token=await sessionToken(clerkId);
  user=await authenticatedUser(new Request('https://example.com/api/me',{headers:{Authorization:`Bearer ${token}`}}),env);
});
const call=(path:string, data?:object,key=crypto.randomUUID())=>groupsApi(new Request(`https://example.com/api${path}`,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':key},body:data?JSON.stringify(data):undefined}),env);
async function create(){const r=await call('/groups',{name:'Weekend',currency:'USD'});expect(r?.status).toBe(201);return (await r!.json() as {id:string}).id;}
async function invite(id:string){const response=await call(`/groups/${id}/invites`,{email});expect(response?.status).toBe(201);return await response!.json() as {id:string;link:string};}

describe('groups and invitations with real D1 transactions',()=>{
  it('atomically creates membership and audit, safely replays creation, and rejects key reuse',async()=>{
    const key=crypto.randomUUID();
    const r=await call('/groups',{name:'Dinner',currency:'USD'},key);const first=await r!.json() as {id:string};
    const replay=await call('/groups',{name:'Dinner',currency:'USD'},key);expect(await replay!.json()).toEqual(first);
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id=?').bind(first.id).first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM audit_events WHERE group_id=?').bind(first.id).first('n')).toBe(1);
    await expect(call('/groups',{name:'Changed',currency:'USD'},key)).rejects.toMatchObject({status:409});
  });
  it('public group returns only approved fields without requiring authentication',async()=>{
    const id=await create();const invitation=await invite(id);
    token='';
    const response=await call(`/groups/${id}`);const text=JSON.stringify(await response!.json());
    expect(text).toContain('Taylor');expect(text).not.toContain(email);expect(text).not.toContain('clerk_');expect(text).not.toContain(invitation.link.split('/').pop());
    expect(Object.keys(JSON.parse(text))).toEqual(['group','members','expenses','repayments','debts']);
  });
  it('blocks unrelated users from invitations and creator settings',async()=>{
    const id=await create();const outsider=uniqueClerkUser();mockClerkUser(outsider);token=await sessionToken(outsider);
    await expect(call(`/groups/${id}/settings`)).rejects.toMatchObject({status:403});
    await expect(call(`/groups/${id}/invites`,{email})).rejects.toMatchObject({status:403});
  });
  it('requires the intended verified email and acceptance is one-time without duplicate membership',async()=>{
    const id=await create();const invitation=await invite(id);const token=invitation.link.split('/').pop();
    mockClerkUser(clerkId,{email:'other@example.test'});
    await expect(call(`/invitations/${token}`,{})).rejects.toMatchObject({status:403});
    mockClerkUser(clerkId,{email:email.toUpperCase()});
    const result=await Promise.all([call(`/invitations/${token}`,{}),call(`/invitations/${token}`,{})]);
    for(const r of result) expect(await r!.json()).toEqual({group_id:id});
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id=?').bind(id).first('n')).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM audit_events WHERE group_id=? AND kind='member.accepted'").bind(id).first('n')).toBe(1);
  });
  it('adds multiple distinct recipients to the same group and lists only their memberships',async()=>{
    const id=await create(); const creatorToken=token;
    for(let index=0;index<2;index++) {
      token=creatorToken;
      const recipient=uniqueClerkUser();email=`${recipient}@example.test`;
      const invitation=await invite(id);
      mockClerkUser(recipient,{email});token=await sessionToken(recipient);
      const accepted=await call(`/invitations/${invitation.link.split('/').pop()}`,{});
      expect(await accepted!.json()).toEqual({group_id:id});
      const dashboard=await call('/groups');expect((await dashboard!.json() as {groups:{id:string}[]}).groups.map(g=>g.id)).toEqual([id]);
    }
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id=?').bind(id).first('n')).toBe(3);
  });
  it('stores only hashed tokens and replay cannot duplicate an invitation',async()=>{
    const id=await create();const key=crypto.randomUUID();const response=await call(`/groups/${id}/invites`,{email},key);const first=await response!.json() as {link:string;id:string};
    const replay=await call(`/groups/${id}/invites`,{email},key);expect(await replay!.json()).toEqual({id:first.id,replayed:true});
    const stored=await env.DB.prepare('SELECT token_hash FROM invites WHERE id=?').bind(first.id).first('token_hash');
    expect(stored).toBe(await hash(first.link.split('/').pop()!));
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM invites WHERE group_id=?').bind(id).first('n')).toBe(1);
  });
  it('replacement revokes the previous invitation without changing the group URL',async()=>{
    const id=await create();const first=await invite(id);const second=await invite(id);
    await expect(call(`/invitations/${first.link.split('/').pop()}`,{})).rejects.toMatchObject({status:410});
    const response=await call(`/invitations/${second.link.split('/').pop()}`);expect((await response!.json() as {group_id:string}).group_id).toBe(id);
    await call(`/groups/${id}/invites/${second.id}/revoke`,{});
    await expect(call(`/invitations/${second.link.split('/').pop()}`,{})).rejects.toMatchObject({status:410});
  });
  it('rejects expired invitations and archived group mutations',async()=>{
    const id=await create();const first=await invite(id);
    await env.DB.prepare('UPDATE invites SET expires_at=0 WHERE id=?').bind(first.id).run();
    await expect(call(`/invitations/${first.link.split('/').pop()}`,{})).rejects.toMatchObject({status:410});
    const second=await invite(id);await env.DB.prepare('UPDATE groups SET archived=1 WHERE id=?').bind(id).run();
    await expect(call(`/groups/${id}/invites`,{email})).rejects.toMatchObject({status:403});
    await expect(call(`/invitations/${second.link.split('/').pop()}`,{})).rejects.toMatchObject({status:409});
    expect(await env.DB.prepare('SELECT redeemed_by FROM invites WHERE id=?').bind(second.id).first('redeemed_by')).toBeNull();
  });
  it('removed creators lose invitation write permissions and membership is retained',async()=>{
    const id=await create();await env.DB.prepare("UPDATE group_members SET status='removed' WHERE group_id=?").bind(id).run();
    await expect(call(`/groups/${id}/invites`,{email})).rejects.toMatchObject({status:403});
    const response=await call(`/groups/${id}`);expect((await response!.json() as {members:{status:string}[]}).members[0].status).toBe('removed');
  });
  it('rate limits writes atomically and rejects malformed inputs',async()=>{
    await expect(call('/groups',{name:'',currency:'USD'})).rejects.toMatchObject({status:400});
    await env.DB.prepare('INSERT INTO write_limits VALUES(?,?,30)').bind(user.id,Math.floor(Date.now()/60000)).run();
    await expect(call('/groups',{name:'Trip',currency:'USD'})).rejects.toMatchObject({status:429});
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM groups WHERE creator_id=?').bind(user.id).first('n')).toBe(0);
  });
});
