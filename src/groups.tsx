import { useAuth } from '@clerk/react';
import { useEffect, useState, type FormEvent } from 'react';
import { SignIn } from './session';

type Group = {id:string;name:string;currency:string;creator_id:string;archived:number};
type Member = {id:string;display_name:string;role:string;status:string};
type Invitation = {id:string;email:string;expires_at:number;revoked:number;accepted:number};
const currencies = ['USD','EUR','GBP','CAD','AUD','JPY','CHF','NZD','SGD','HKD','INR','CNY','KRW','MXN','BRL'];
async function read(response:Response) { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Something went wrong. Try again.'); return data; }
function useApi() {
  const {getToken} = useAuth();
  return async (path:string, value?:object, key?:string) => {
    const token = await getToken();
    if (!token) throw new Error('Sign in to continue.');
    return read(await fetch(path,{method:value ? 'POST':'GET',cache:'no-store',headers:{Authorization:`Bearer ${token}`,...(value ? {'Content-Type':'application/json','Idempotency-Key':key || crypto.randomUUID()}: {})},body:value ? JSON.stringify(value):undefined}));
  };
}
function CopyLink({value,label='Copy link'}:{value:string;label?:string}) {
  const [copied,setCopied] = useState(false);
  const [failed,setFailed] = useState(false);
  return <><button type="button" className="button button-small" onClick={async()=>{try{await navigator.clipboard.writeText(value);setCopied(true);}catch{setFailed(true);}}}>{copied?'Copied!':label}</button>{failed && <input aria-label="Link to copy" value={value} readOnly onFocus={e=>e.target.select()}/>}</>;
}
export function GroupsDashboard() {
  const {isLoaded,isSignedIn,userId} = useAuth();
  const api = useApi();
  const [groups,setGroups] = useState<Group[]>();
  const [owner,setOwner] = useState<string|null|undefined>();
  const [error,setError] = useState('');
  const [attempt,setAttempt] = useState(0);
  const [busy,setBusy] = useState(false);
  const [name,setName] = useState('');
  const [currency,setCurrency] = useState('USD');
  const [key,setKey] = useState(()=>crypto.randomUUID());
  useEffect(()=>{let active=true;if(isSignedIn){setGroups(undefined);setError('');setOwner(userId);api('/api/groups').then(d=>{if(active)setGroups(d.groups);}).catch(e=>{if(active)setError(e.message);});}return()=>{active=false;};},[isSignedIn,userId,attempt]);
  async function create(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{const data=await api('/api/groups',{name,currency},key);window.location.assign(`/s/${data.id}`);}catch(e){setError((e as Error).message);setBusy(false);}}
  if (!isLoaded) return <p>Loading your groups…</p>;
  if (!isSignedIn) return <section className="dashboard"><h1>Your groups.</h1><p>Sign in to create a group or view your memberships.</p><SignIn/></section>;
  return <section className="dashboard"><p className="eyebrow">YOUR GROUPS</p><h1>Shared plans.<br/><em>One place.</em></h1>{error && <p role="alert">{error} <button onClick={()=>setAttempt(n=>n+1)}>Retry</button></p>}{owner===userId && groups ? <div className="group-list">{groups.length ? groups.map(g=><a className="group-card" href={`/s/${g.id}`} key={g.id}><h2>{g.name}</h2><p>{g.currency} · Settled up{g.archived?' · Archived':''}</p></a>):<p>No groups yet. Start with a friend, a trip, or your household.</p>}</div>:<p>Loading your groups…</p>}<form className="group-form" onSubmit={create}><h2>Create a group</h2><label>Group name<input required maxLength={100} value={name} onChange={e=>{setName(e.target.value);setKey(crypto.randomUUID());}} placeholder="Weekend in New York"/></label><label>Currency<select value={currency} onChange={e=>{setCurrency(e.target.value);setKey(crypto.randomUUID());}}>{currencies.map(c=><option key={c}>{c}</option>)}</select></label><p className="small">One currency for the group. It becomes fixed after the first expense or repayment.</p><button disabled={busy} className="button">{busy?'Creating…':'Create group'}</button></form></section>;
}
function MemberControls({group}:{group:Group}) {
  const {isSignedIn,userId} = useAuth();
  const api = useApi();
  const [creator,setCreator] = useState(false);
  useEffect(()=>{let active=true;setCreator(false);if(isSignedIn)api('/api/me').then(d=>{if(active)setCreator(d.user.id===group.creator_id);}).catch(()=>{});return()=>{active=false;};},[isSignedIn,userId,group.creator_id]);
  if (!isSignedIn) return <p>Anyone with this link can view this group. <SignIn className="text-button">Sign in</SignIn> to use an accepted membership.</p>;
  return creator ? <a className="button button-small" href={`/s/${group.id}/settings`}>Manage invitations</a>:null;
}
export function PublicGroup({id,configured}:{id:string;configured:boolean}) {
  const [data,setData] = useState<{group:Group;members:Member[]}>();
  const [error,setError] = useState('');
  useEffect(()=>{const controller=new AbortController();fetch(`/api/groups/${id}`,{signal:controller.signal,cache:'no-store'}).then(read).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[id]);
  if(error)return <p role="alert">{error}</p>;
  if(!data)return <p>Loading the group…</p>;
  return <section className="dashboard"><p className="eyebrow">SHARED GROUP · {data.group.currency}</p><h1>{data.group.name}</h1><div className="actions"><CopyLink value={`${window.location.origin}/s/${id}`}/>{configured && <MemberControls group={data.group}/>}</div><p className="small">Anyone with this link can read names, expenses, and balances. Only accepted members can make changes.</p>{Boolean(data.group.archived)&&<p role="status">This group is archived and read-only.</p>}<div className="group-card"><h2>Everyone is settled up</h2><p>No expenses or repayments yet. Expense tracking is coming next.</p></div><h2>Members</h2><ul className="member-list">{data.members.map(m=><li key={m.id}><span>{m.display_name}</span><span>{m.role==='creator'?'Creator':m.status==='removed'?'Removed':'Member'} · {new Intl.NumberFormat(undefined,{style:'currency',currency:data.group.currency}).format(0)}</span></li>)}</ul><h2>History</h2><p>Expenses and repayments will appear here as the group starts sharing.</p></section>;
}
export function InvitationPage({token}:{token:string}) {
  const {isLoaded,isSignedIn} = useAuth();
  const api=useApi();
  const [data,setData]=useState<{name:string;archived:boolean}>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{const controller=new AbortController();fetch(`/api/invitations/${token}`,{signal:controller.signal,cache:'no-store'}).then(read).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[token]);
  async function accept(){setBusy(true);setError('');try{const d=await api(`/api/invitations/${token}`,{});window.location.assign(`/s/${d.group_id}`);}catch(e){setError((e as Error).message);setBusy(false);}}
  return <section className="dashboard"><p className="eyebrow">YOU’RE INVITED</p><h1>{data?`Join ${data.name}`:'Group invitation'}</h1>{error&&<p role="alert">{error}</p>}{!data&&!error&&<p>Loading invitation…</p>}{data&&<><p className="lead">Accept to become a member. Use the account with the verified email address your invitation was sent to.</p><p>Membership is optional. The group’s public link can be viewed by anyone.</p>{data.archived?<p>This group is archived. Ask the creator to reopen it.</p>:!isLoaded?<p>Loading sign-in…</p>:isSignedIn?<button className="button" disabled={busy} onClick={accept}>{busy?'Accepting…':'Accept membership'}</button>:<SignIn>Sign in to accept</SignIn>}</>}</section>;
}
export function GroupSettings({id}:{id:string}) {
  const {isLoaded,isSignedIn,userId}=useAuth();
  const api=useApi();
  const [invites,setInvites]=useState<Invitation[]>();
  const [owner,setOwner]=useState<string|null|undefined>();
  const [email,setEmail]=useState('');
  const [error,setError]=useState('');
  const [link,setLink]=useState('');
  const [busy,setBusy]=useState(false);
  const [key,setKey]=useState(()=>crypto.randomUUID());
  async function reload(){const d=await api(`/api/groups/${id}/settings`);setInvites(d.invites);}
  useEffect(()=>{let active=true;setOwner(userId);setInvites(undefined);setLink('');setError('');if(isSignedIn)api(`/api/groups/${id}/settings`).then(d=>{if(active)setInvites(d.invites);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[isSignedIn,userId,id]);
  async function invite(e:FormEvent){e.preventDefault();setBusy(true);setError('');setLink('');try{const d=await api(`/api/groups/${id}/invites`,{email},key);if(d.link)setLink(d.link);else setError('This invitation was already created. Its link is only shown once; create a replacement to get a new link.');setKey(crypto.randomUUID());await reload();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function revoke(inviteId:string){setBusy(true);setError('');try{await api(`/api/groups/${id}/invites/${inviteId}/revoke`,{});await reload();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  if(!isLoaded)return <p>Loading…</p>;
  if(!isSignedIn)return <section className="dashboard"><h1>Group settings</h1><SignIn/></section>;
  return <section className="dashboard"><a href={`/s/${id}`}>← Back to group</a><h1>Invitations</h1>{error&&<p role="alert">{error}</p>}{owner===userId&&invites&&<><form className="group-form" onSubmit={invite}><label>Member’s email<input type="email" required maxLength={254} value={email} onChange={e=>{setEmail(e.target.value);setKey(crypto.randomUUID());}}/></label><p className="small">Share the generated link yourself. It expires in 7 days and only this verified email can accept. Creating another invitation for the same email replaces the previous one.</p><button disabled={busy} className="button">{busy?'Saving…':'Create invitation'}</button></form>{link&&<div className="group-card"><p>Save and share this invitation now. Its link is only shown once.</p><CopyLink value={link} label="Copy invitation link"/></div>}<ul className="invite-list">{invites.map(i=><li key={i.id}><span>{i.email}<small>{i.accepted?'Accepted':i.revoked?'Revoked':i.expires_at*1000<Date.now()?'Expired':`Expires ${new Date(i.expires_at*1000).toLocaleDateString()}`}</small></span>{!i.accepted&&!i.revoked&&<button disabled={busy} onClick={()=>revoke(i.id)}>Revoke</button>}</li>)}</ul></>}</section>;
}
