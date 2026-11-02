import { useState } from 'react';
import { hasFigure, teamApi, type AgentId, type ContentView, type TeamView } from '../api';
import { AccountCard, AccountData, AuditCard } from './Insights';
import { CadenceDots, LEVER, MixBar, PairBars, PlanMix, hue, num, sameFormat } from './Numbers';
import { ago, useAction } from './shared';
import type { View } from './Studio';

// Insights: the numbers first. The Director's plan, your account against the field, then the research
// and the account analysis in full. Everything here is read; deciding happens in Today.
export function InsightsView({ pid, team, view, reload, go, askAgent }: { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const { busy, error, run } = useAction(reload);
  const working = Boolean(team.working) || busy !== '';
  const brief = () => run('brief', () => teamApi.run(pid, ['scout', 'analyst', 'strategist'], ''));
  const TABS: Array<[Tab, string]> = [['plan', 'The plan'], ['compare', 'You vs the field'], ['field', 'What works out there'], ['account', 'Your account']];
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('insights-tab') as Tab) || 'plan'; } catch { return 'plan'; } });
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem('insights-tab', t); } catch { /* fine */ } };
  return (
    <div className="stack">
      <div className="itabs" role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => pick(id)}>{label}</button>)}</div>
      {tab === 'plan' && <>
      <div className="today">
        <div><b>The plan</b><span className="hint small">What to post in the coming weeks, each line with the numbers behind it. Written by the Director from the research and your account.</span></div>
        <span className="row nomargin">
          <button disabled={working || (!team.audit && !team.account)} title={!team.audit && !team.account ? 'Research the field or load your posts first' : ''} onClick={() => run('plan', () => teamApi.plan(pid))}>{busy === 'plan' ? 'Planning…' : team.plan ? 'Redo the plan' : 'Write the plan'}</button>
          <button className="linkish" onClick={() => askAgent('director')}>Ask the Director →</button>
        </span>
      </div>
      <PlanCard team={team} go={go} />
      {error && <p className="error">{error}</p>}
      </>}

      {tab === 'compare' && <>
      <div className="today">
        <div><b>You vs the field</b><span className="hint small">Your average score per format next to the measure the Scout found for it. Not the same unit: yours is a score, theirs is what the field reports.</span></div>
      </div>
      <CompareCard team={team} />
      </>}

      {tab === 'field' && <>
      <div className="today">
        <div><b>What works out there</b><span className="hint small">The Scout's field research, with the figures it measured and where they come from.</span></div>
        <button className="linkish" onClick={() => askAgent('scout')}>Ask the Scout →</button>
      </div>
      <AuditCard pid={pid} audit={team.audit} log={team.audits} onBrief={working ? undefined : brief} />
      </>}

      {tab === 'account' && <>
      <div className="today">
        <div><b>Your account</b><span className="hint small">The Analyst's comparison: scores per format, your best and worst posts, strengths and gaps.</span></div>
        <button className="linkish" onClick={() => askAgent('analyst')}>Ask the Analyst →</button>
      </div>
      <AccountCard team={team} />
      <AccountData pid={pid} team={team} items={view.items} reload={reload} />
      </>}
    </div>
  );
}
type Tab = 'plan' | 'compare' | 'field' | 'account';

function PlanCard({ team, go }: { team: TeamView; go: (v: View) => void }) {
  const p = team.plan;
  if (!p) return (
    <section className="card guide">
      <h3>No plan yet</h3>
      <ol className="steps">
        <li><span className="tick">1</span><span>The Scout measures the field and the Analyst scores your posts.</span></li>
        <li><span className="tick">2</span><span>The Director turns that into a format mix: how many of each, why, with the numbers next to each line.</span></li>
        <li><span className="tick">3</span><span>Ideas then follow the plan, and you decide on each in <button className="linkish" onClick={() => go('today')}>Today</button>.</span></li>
      </ol>
      <p className="hint small">{team.audit || team.account ? 'Press “Write the plan” above.' : 'Brief the team in Create first: it needs the field research or your posts.'}</p>
    </section>
  );
  const d = p.data;
  return (
    <section className="card hero-card plan">
      {p.simulated && <span className="demo">Built on demo numbers</span>}
      <p className="headline">{d.headline}</p>
      <div className="chips">
        <span className="pill">{d.period}</span>
        <span className="pill">{d.basis.posts} post{d.basis.posts === 1 ? '' : 's'} analysed</span>
        <span className={`pill ${d.basis.audited ? 'good' : 'neg'}`}>{d.basis.audited ? 'field research: done' : 'no field research yet'}</span>
        <span className="hint small">Written {ago(p.at)}</span>
      </div>
      <div className="two uneven">
        <div><h4 className="mini">The mix: {d.mix.reduce((a, l) => a + l.count, 0)} posts</h4><MixBar plan={d} /></div>
        <div><h4 className="mini">The rhythm</h4><CadenceDots plan={d} /></div>
      </div>
      <h4 className="mini">Line by line, with the numbers</h4>
      <PlanMix plan={d} simulated={p.simulated} />
      <div className="lever-legend">{(Object.keys(LEVER) as Array<keyof typeof LEVER>).map(k => <span key={k}><span className={`lever ${k}`}>{LEVER[k].label}</span><small>{LEVER[k].hint}</small></span>)}</div>
      <div className="two">
        <div className="why-big"><b>Cadence</b><p>{d.cadence}</p></div>
        <div className="why-big"><b>Next</b><p>{d.next}</p></div>
      </div>
    </section>
  );
}

// Posts per week on this account, from the dates of the loaded posts.
function postsPerWeek(posts: TeamView['posts']): number | undefined {
  if (posts.length < 2) return undefined;
  const days = posts.map(p => Date.parse(p.postedAt)).filter(Number.isFinite);
  const span = (Math.max(...days) - Math.min(...days)) / 86_400_000;
  return span > 0 ? Math.round((posts.length / span) * 7 * 10) / 10 : undefined;
}

function CompareCard({ team }: { team: TeamView }) {
  const stats = team.account?.data.stats ?? [];
  const works = team.audit?.data.whatWorks ?? [];
  const benches = team.audit?.data.benchmarks ?? [];
  if (!stats.length && !works.length) return <section className="card empty"><p>Nothing to compare yet.</p><p className="hint small">Load your posts and research the field: this table fills in on its own.</p></section>;
  const max = Math.max(1, ...stats.map(s => s.avgEngagement));
  const names = [...stats.map(s => s.format), ...works.filter(w => !stats.some(s => sameFormat(s.format, w.format))).map(w => w.format)];
  const lever = (f: string) => team.plan?.data.mix.find(l => sameFormat(l.format, f))?.lever;
  const cadence = postsPerWeek(team.posts);
  const freq = benches.find(b => /frequen|per week|posts? ?\/ ?week|a week/i.test(`${b.name} ${b.unit}`));
  return (
    <section className="card">
      {(cadence !== undefined || freq) && (
        <div className="cmp-cadence">
          <h4 className="mini">Posts per week</h4>
          <PairBars a={{ label: 'You', value: cadence, note: team.account?.simulated ? 'demo account' : 'from the dates of your posts' }} b={{ label: 'The field', value: freq?.value, note: freq ? `${freq.name}${freq.source ? ` · ${new URL(freq.source).hostname.replace(/^www\./, '')}` : ''}` : 'no field figure on posting frequency' }} />
        </div>
      )}
      <h4 className="mini">Score per format</h4>
      <div className="cmp" role="table" aria-label="Your score per format against the field">
        <div className="cmp-head" role="row"><span>Format</span><span>Your average score</span><span>In the field</span><span>Plan</span></div>
        {names.map(f => {
          const s = stats.find(x => sameFormat(x.format, f));
          const w = works.find(x => sameFormat(x.format, f));
          const lv = lever(f);
          return (
            <div key={f} className="cmp-row" role="row" style={{ ['--h' as string]: hue(f) }}>
              <span className="cmp-name"><i /> {f}</span>
              <span className="cmp-bar">{s ? <><div><i style={{ width: `${(s.avgEngagement / max) * 100}%` }} /></div><b>{num(s.avgEngagement)}</b><small>{s.posts} post{s.posts > 1 ? 's' : ''}</small></> : <small className="hint">not posted yet</small>}</span>
              <span className="cmp-field">{w && hasFigure(w.figure) ? <><b>{num(w.figure.value)}{w.figure.unit.startsWith('%') ? '%' : ` ${w.figure.unit}`}</b><small>{w.figure.what}</small></> : w ? <small className="hint">works, no figure found</small> : <small className="hint">not in the research</small>}</span>
              <span className="cmp-lever">{lv ? <span className={`lever ${lv}`}>{LEVER[lv].label}</span> : <small className="hint">–</small>}</span>
            </div>
          );
        })}
      </div>
      <p className="hint small">Score = likes + 2 × comments + 3 × shares + 3 × saves. Field figures are what each source reports, in its own unit, with the source on the research card below.</p>
    </section>
  );
}
