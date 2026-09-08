import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
function App() {
 return <div className="page">
  <header><a className="brand" href="/" aria-label="KobeSplit home"><span className="mark" aria-hidden="true">k.</span>KobeSplit</a><span className="tag">A little less owing.</span></header>
  <main>
   <section className="intro"><p className="eyebrow">SHARED EXPENSES, MADE SIMPLE</p><h1>Good company.<br/><em>Clear balances.</em></h1><p className="lead">From dinner for two to a trip with the whole crew. Keep expenses, repayments, and who owes whom together in one shared group.</p><div className="status"><span className="dot"/>We're getting things ready.</div><p className="small">Sign-in and shared ledgers are coming next.</p></section>
   <aside aria-label="How KobeSplit works"><div className="card-heading"><span>LESS MATH. MORE MEMORIES.</span><span aria-hidden="true">↗</span></div><ol><li><span className="number">01</span><div><h2>Make it a group</h2><p>A friend, your roommates, or the whole trip. Everyone belongs in the same flow.</p></div></li><li><span className="number">02</span><div><h2>Keep one shared link</h2><p>Anyone with the link can view. Accepted members can add expenses.</p></div></li><li><span className="number">03</span><div><h2>Settle up. Stay together.</h2><p>Record repayments made elsewhere. Keep the group and its history for next time.</p></div></li></ol><div className="card-foot">One group. One currency. Everything in view.</div></aside>
  </main><footer><span>For the things you share.</span><span>KobeSplit records payments. It doesn't move money.</span></footer>
 </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
