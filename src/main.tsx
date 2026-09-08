import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider, Show, UserButton } from '@clerk/react';
import { SignIn } from './session';
import { GroupsDashboard, PublicGroup, InvitationPage, GroupSettings } from './groups';
import './style.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const configured = Boolean(publishableKey);

function Header() {
  return <header><a className="brand" href="/" aria-label="KobeSplit home"><span className="mark" aria-hidden="true">k.</span>KobeSplit</a>
    <nav aria-label="Account">{configured && <>
      <Show when="signed-out"><SignIn className="button button-small"/></Show>
      <Show when="signed-in"><a className="nav-link" href="/dashboard">Your groups</a><UserButton/></Show>
    </>}</nav>
  </header>;
}
function Landing() {
  return <main>
    <section className="intro"><p className="eyebrow">SHARED EXPENSES, MADE SIMPLE</p><h1>Good company.<br/><em>Clear balances.</em></h1><p className="lead">From dinner for two to a trip with the whole crew. Keep expenses, repayments, and who owes whom together in one shared group.</p>
      <div className="actions">{configured ? <><Show when="signed-out"><SignIn>Get started</SignIn></Show><Show when="signed-in"><a className="button" href="/dashboard">Your groups <span aria-hidden="true">↗</span></a></Show></> : <p role="status">Sign-in is temporarily unavailable.</p>}</div>
      <p className="small">Create a group and invite your people. Expense tracking is coming next.</p>
    </section>
    <aside aria-label="How KobeSplit works"><div className="card-heading"><span>LESS MATH. MORE MEMORIES.</span><span aria-hidden="true">↗</span></div><ol><li><span className="number">01</span><div><h2>Make it a group</h2><p>A friend, your roommates, or the whole trip. Everyone belongs in the same flow.</p></div></li><li><span className="number">02</span><div><h2>Keep one shared link</h2><p>Anyone with the link can view. Accepted members can add expenses.</p></div></li><li><span className="number">03</span><div><h2>Settle up. Stay together.</h2><p>Record repayments made elsewhere. Keep the group and its history for next time.</p></div></li></ol><div className="card-foot">One group. One currency. Everything in view.</div></aside>
  </main>;
}
function App() {
  const path = window.location.pathname;
  const group = path.match(/^\/s\/([a-f0-9-]{36})(\/settings)?$/);
  const invite = path.match(/^\/invite\/([a-f0-9]{64})$/);
  const protectedPage = path === '/dashboard' || invite || group?.[2];
  const content = group && !group[2] ? <PublicGroup id={group[1]} configured={configured}/> : protectedPage ? !configured ? <p role="status">Sign-in is temporarily unavailable.</p> : invite ? <InvitationPage token={invite[1]}/> : group ? <GroupSettings id={group[1]}/> : <GroupsDashboard/> : null;
  return <div className="page"><Header/>{content ? <main className="dashboard-main">{content}</main> : <Landing/>}<footer><span>For the things you share.</span><span>KobeSplit records payments. It doesn't move money.</span></footer></div>;
}
function AuthenticationProvider({ children }: { children: ReactNode }) {
  if (!configured) return children;
  return <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/" appearance={{ variables: { colorPrimary: '#193b31', borderRadius: '0.75rem', fontFamily: 'DM Sans, sans-serif' } }}>{children}</ClerkProvider>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><AuthenticationProvider><App/></AuthenticationProvider></StrictMode>);
