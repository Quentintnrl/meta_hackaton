import { useEffect, useRef, useState, type ReactNode } from 'react';
import { teamApi, type AgentId, type ChatBase, type ChatMessage, type ContentItem, type ContentView, type SuggestedAction, type TeamView } from '../api';
import { Avatar, agentState } from './Agents';
import { KindChip, ago, fmt } from './shared';

// The team's conversation. The manager asks; the question goes to the agent whose job it is (or to the one
// the manager picked), that agent answers from its real material and may offer things to do: revise the
// text, change the brief, put a piece on the board, move a date, run a colleague. Each offer is a card with
// its reason; nothing happens until the manager clicks. Under every answer: what it leaned on.

export const NAME: Record<AgentId, string> = { director: 'Director', scout: 'Scout', analyst: 'Analyst', strategist: 'Strategist', writer: 'Writer' };
const AGENTS: AgentId[] = ['director', 'scout', 'analyst', 'strategist', 'writer'];
const KNOWS: Record<AgentId, string> = { director: 'the whole team, the plan', scout: 'the field, competitors, dates', analyst: 'your posts and their numbers', strategist: 'the board, the roadmap, angles', writer: 'the text, first lines, pictures' };
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export type Subject = { key: string; label: string; context: string; item?: ContentItem };
export type Starter = { agent: AgentId; text: string };

// Questions worth asking right now, from the data on screen: the silence, the best post, the next date, the
// proposals waiting. Each one names who will answer. The page in front decides which come first.
export function startersFor(team: TeamView, view: ContentView, subject?: Subject, hint = ''): Starter[] {
  const out: Starter[] = [];
  const i = subject?.item;
  if (i) {
    if (i.status === 'idea') out.push({ agent: 'strategist', text: 'Why this angle and not another?' }, { agent: 'strategist', text: 'Give me two other angles on the same idea' }, { agent: 'writer', text: 'What would the first line be?' }, { agent: 'analyst', text: 'Did something like this work for us before?' });
    else if (i.draft) out.push({ agent: 'writer', text: 'Make the first line punchier' }, { agent: 'writer', text: 'Cut it by a third, same idea' }, { agent: 'analyst', text: 'Compare it with our best post' }, { agent: 'strategist', text: 'Is the date right for it?' });
    else out.push({ agent: 'writer', text: 'How would you open it?' }, { agent: 'strategist', text: 'When should it go out, and why?' }, { agent: 'analyst', text: 'What do our numbers say about this kind of post?' });
    return out.slice(0, 4);
  }
  const f = team.facts;
  const waiting = view.items.filter(x => x.status === 'idea').length;
  const ev = team.watch?.data.events[0];
  const player = team.watch?.data.players[0];
  const analyst: Starter[] = [];
  if (f?.silences.length) { const s = [...f.silences].sort((a, b) => b.days - a.days)[0]; analyst.push({ agent: 'analyst', text: `What happened during the ${s.days}-day silence?` }); }
  if (f?.trend.direction === 'down') analyst.push({ agent: 'analyst', text: 'Why are the likes going down?' });
  else if (f?.trend.direction === 'up') analyst.push({ agent: 'analyst', text: 'What is pulling the likes up?' });
  if (f?.best.text) analyst.push({ agent: 'analyst', text: `Why did “${cut(f.best.text, 38)}” work so well?` });
  if (!f) analyst.push({ agent: 'analyst', text: 'What do you need from me to read the account?' });
  const scout: Starter[] = [];
  if (ev) scout.push({ agent: 'scout', text: `What should we post before ${cut(ev.name, 40)}?` });
  if (player) scout.push({ agent: 'scout', text: `What does ${cut(player.name, 30)} do that we do not?` });
  scout.push({ agent: 'scout', text: team.audit ? 'What works in our field right now?' : 'What do comparable accounts post?' });
  const strategist: Starter[] = [waiting > 1 ? { agent: 'strategist', text: `Which of the ${waiting} proposals should go first?` } : { agent: 'strategist', text: 'What should we post next week?' }];
  const director: Starter[] = [team.plan ? { agent: 'director', text: 'Are we on the plan?' } : { agent: 'director', text: 'What should we do this week?' }];
  const order = hint === 'community' || hint === 'platforms' ? [analyst, scout, strategist, director]
    : hint === 'watch' || hint === 'agenda' ? [scout, strategist, analyst, director]
    : hint === 'settings' || hint === 'team' || hint === 'insights' ? [director, strategist, analyst, scout]
    : [strategist, analyst, scout, director];
  // One from each group first, then the rest, so the four shown cover different agents.
  for (let k = 0; out.length < 4 && k < 3; k++) for (const g of order) if (g[k] && out.length < 4) out.push(g[k]);
  return out;
}

// What the team can see right now, as labels: shown before the first question so the manager knows what to expect.
export function knowsFor(team: TeamView, view: ContentView, subject?: Subject): string[] {
  const k: string[] = [];
  if (subject) k.push(`the ${subject.key.startsWith('milestone') ? 'goal' : 'piece'} “${cut(subject.label, 36)}”`);
  if (team.accountPosts) k.push(`your ${team.accountPosts} posts`);
  if (team.audit) k.push(`the field research of ${fmt(team.audit.at.slice(0, 10))}`);
  if (team.watch) k.push(`the competitor watch of ${fmt(team.watch.at.slice(0, 10))}`);
  if (team.plan) k.push('the plan');
  const waiting = view.items.filter(x => x.status === 'idea').length;
  if (waiting) k.push(`${waiting} proposal${waiting === 1 ? '' : 's'} waiting`);
  const goals = view.milestones.filter(m => m.status === 'open').length;
  if (goals) k.push(`${goals} goal${goals === 1 ? '' : 's'} on the roadmap`);
  return k;
}

// The words of an answer: paragraphs, lists, bold. Nothing more.
function Text({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const inline = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/g).map((p, n) => p.startsWith('**') && p.endsWith('**') ? <b key={n}>{p.slice(2, -2)}</b> : p);
  return <>{blocks.map((b, n) => {
    const lines = b.split('\n');
    if (lines.every(l => /^\s*([-•*]|\d+[.)])\s+/.test(l))) return <ul key={n}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-•*]|\d+[.)])\s+/, ''))}</li>)}</ul>;
    if (/^#{1,3}\s/.test(lines[0])) return <p key={n}><b>{inline(lines[0].replace(/^#+\s/, ''))}</b>{lines.length > 1 && <><br />{inline(lines.slice(1).join('\n'))}</>}</p>;
    return <p key={n}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
  })}</>;
}

const VERB: Record<SuggestedAction['kind'], string> = { run: 'Run it', configure: 'Apply', generate: 'Generate', revise: 'Make the change', rebrief: 'Change the brief', propose: 'Put it on the board', date: 'Move it', talk: 'Ask' };

// One offer: what it does, why, exactly what will change, and the click. Done once, then a way to the result.
function ActionCard({ a, state, onApply, onOpen, onTalk }: { a: SuggestedAction; state?: 'busy' | { itemId?: string }; onApply: () => void; onOpen?: (id: string) => void; onTalk?: (agent: AgentId) => void }) {
  const done = state !== undefined && state !== 'busy';
  const itemId = (done && state && typeof state === 'object' && state.itemId) || a.itemId;
  const detail: ReactNode = a.kind === 'revise' ? <q>{a.instruction}</q>
    : a.kind === 'rebrief' ? <q>{a.brief}</q>
    : a.kind === 'propose' ? <span className="acard-piece">{a.pieceKind && <KindChip kind={a.pieceKind} />}<b>{a.title}</b>{a.hook && <em>“{a.hook}”</em>}<small>{[a.channel, a.date && fmt(a.date)].filter(Boolean).join(' · ')}</small></span>
    : a.kind === 'date' ? <span>→ {a.date && fmt(a.date)}</span>
    : a.kind === 'run' ? <span>{(a.agents ?? []).map(x => NAME[x]).join(' → ')}{a.brief ? <>: <q>{a.brief}</q></> : null}</span>
    : a.kind === 'configure' ? <span>{[a.agent && NAME[a.agent], a.enabled === undefined ? '' : a.enabled ? 'on' : 'off', a.workers ? `${a.workers} at once` : ''].filter(Boolean).join(' · ')}{a.instructions && <q>{a.instructions}</q>}</span>
    : a.kind === 'generate' ? <span>One paid image call per picture.</span> : null;
  if (a.kind === 'talk') return <button className="acard door" onClick={() => a.agent && onTalk?.(a.agent)}>{a.agent && <Avatar id={a.agent} state="idle" size={22} />}<b>{a.label} →</b></button>;
  return (
    <div className={`acard ${a.kind}${done ? ' done' : ''}`}>
      <div className="acard-main">
        <b>{a.label}</b>
        {a.why && <span className="why">{a.why}</span>}
        {detail && <div className="detail">{detail}</div>}
      </div>
      {done
        ? <span className="acard-done">✓ Done{itemId && onOpen && a.kind !== 'generate' && <button className="linkish tight" onClick={() => onOpen(itemId)}>Open the piece →</button>}</span>
        : <button className="primary" disabled={state === 'busy'} onClick={onApply}>{state === 'busy' ? '…' : VERB[a.kind]}</button>}
    </div>
  );
}

export function TeamChat({ pid, team, view, base, subject, lock, hint, reload, onLock, onTalk, onOpenItem, tall }: {
  pid: string; team: TeamView; view: ContentView;
  base: ChatBase; // the thread: the studio's, or an agent's own
  subject?: Subject; // the piece or goal the chat is about; the agents see it, the manager just asks
  lock?: AgentId; // the agent forced to answer; none = routed to the right one
  hint: string; // the page the manager is on: steers the routing and the starters
  reload: () => Promise<void>;
  onLock?: (a: AgentId | undefined) => void; // shown as a picker when given
  onTalk?: (a: AgentId) => void; // a hand-off door on an agent's own thread
  onOpenItem?: (id: string) => void;
  tall?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<{ text: string; agent?: AgentId } | null>(null);
  const [error, setError] = useState('');
  const [states, setStates] = useState<Record<string, 'busy' | { itemId?: string }>>({});
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const about = subject?.key;

  useEffect(() => { setMessages([]); teamApi.thread(pid, base, about).then(setMessages).catch(() => {}); }, [pid, base, about]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, pending]);
  useEffect(() => { const b = box.current; if (b) { b.style.height = 'auto'; b.style.height = `${Math.min(b.scrollHeight, 120)}px`; } }, [text]);

  async function send(message: string, agent?: AgentId) {
    if (!message.trim() || pending) return;
    setPending({ text: message, agent }); setError(''); setText('');
    try { setMessages(await teamApi.ask(pid, { message, base, about, context: subject?.context || undefined, hint, agent })); }
    catch (e) { setError((e as Error).message); setMessages(await teamApi.thread(pid, base, about).catch(() => [])); }
    finally { setPending(null); }
  }

  async function apply(key: string, a: SuggestedAction) {
    setStates(s => ({ ...s, [key]: 'busy' }));
    try { const r = await teamApi.apply(pid, a); setStates(s => ({ ...s, [key]: { itemId: r.itemId } })); await reload(); }
    catch (e) { setError((e as Error).message); setStates(s => { const { [key]: _, ...rest } = s; return rest; }); }
  }

  const starters = startersFor(team, view, subject, hint);
  const knows = knowsFor(team, view, subject);
  const last = [...messages].reverse().find(m => m.role === 'agent')?.agent;
  const answering = pending?.agent ?? lock;
  return (
    <div className={`tchat${tall ? ' tall' : ''}`}>
      {onLock && (
        <div className="whoa" role="radiogroup" aria-label="Who answers">
          <button role="radio" aria-checked={!lock} className={`whob${lock ? '' : ' on'}`} onClick={() => onLock(undefined)} title="The question goes to the agent whose job it is"><span className="stack-av">{AGENTS.slice(1).map(a => <Avatar key={a} id={a} state="idle" size={18} />)}</span>Whoever knows</button>
          {AGENTS.map(a => <button key={a} role="radio" aria-checked={lock === a} className={`whob${lock === a ? ' on' : ''}${last === a ? ' last' : ''}`} onClick={() => onLock(a)} title={KNOWS[a]}><Avatar id={a} state={agentState(team, a)} size={18} />{NAME[a]}</button>)}
        </div>
      )}
      <div className="msgs" role="log" aria-live="polite">
        {messages.length === 0 && !pending && (
          <div className="chat-empty">
            {knows.length > 0 && <p className="knows"><b>On the table:</b> {knows.join(' · ')}.</p>}
            <p className="hint small">{lock ? `${NAME[lock]} knows ${KNOWS[lock]}. Ask, or tell it how to work.` : 'Ask anything: the question goes to whoever knows. Try one of these:'}</p>
            <div className="starters">{starters.filter(s => !lock || s.agent === lock).map(s => <button key={s.text} className="starter" onClick={() => send(s.text, lock ?? s.agent)}><Avatar id={s.agent} state="idle" size={20} /><span>{s.text}</span></button>)}</div>
          </div>
        )}
        {messages.map((m, i) => {
          const passed = m.role === 'agent' && m.actions.length === 1 && m.actions[0].kind === 'talk' && m.basis?.length === 0 && base === 'team';
          if (passed) return <div key={`${m.id}-${i}`} className="tmsg pass"><Avatar id={m.agent ?? 'director'} state="idle" size={22} /><span><b>{NAME[m.agent ?? 'director']}</b> {m.text} <em>→ {NAME[m.actions[0].agent!]}</em></span></div>;
          return (
            <div key={`${m.id}-${i}`} className={`tmsg ${m.role}`}>
              {m.role === 'agent' && <Avatar id={m.agent ?? (base === 'team' ? 'director' : base)} state="idle" size={30} />}
              <div className="tbody">
                {m.role === 'agent' && <div className="tname"><b>{NAME[m.agent ?? (base === 'team' ? 'director' : base)]}</b>{m.id > 0 && <time>{ago(m.at)}</time>}</div>}
                <div className="bubble"><Text text={m.text} /></div>
                {m.actions.length > 0 && <div className="offers">{m.actions.map((a, j) => { const key = `${m.id}-${j}`; return <ActionCard key={key} a={a} state={states[key]} onApply={() => apply(key, a)} onOpen={onOpenItem} onTalk={onTalk ?? onLock} />; })}</div>}
                {m.role === 'agent' && (m.basis?.length ?? 0) > 0 && <p className="basis">From {m.basis!.join(' · ')}</p>}
                {m.role === 'user' && m.id > 0 && <time>{ago(m.at)}</time>}
              </div>
            </div>
          );
        })}
        {pending && <>
          <div className="tmsg user"><div className="tbody"><div className="bubble">{pending.text}</div></div></div>
          <div className="tmsg agent thinking">{answering ? <Avatar id={answering} state="working" size={30} /> : <span className="stack-av">{AGENTS.slice(1).map(a => <Avatar key={a} id={a} state="working" size={22} />)}</span>}<div className="tbody"><div className="tname"><b>{answering ? `${NAME[answering]} is reading ${KNOWS[answering]}` : 'Finding who knows'}</b></div><div className="bubble typing"><i /><i /><i /></div></div></div>
        </>}
        <div ref={end} />
      </div>
      {error && <p className="error">{error}</p>}
      <form className="composer" onSubmit={e => { e.preventDefault(); void send(text, lock); }}>
        <textarea ref={box} rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text, lock); } }}
          placeholder={subject ? `Ask about “${cut(subject.label, 40)}”…` : lock ? `Ask the ${NAME[lock]}, or tell it how to work…` : 'Ask the team: a number, a competitor, an angle, a line…'} aria-label="Your question" />
        <button className="primary" disabled={Boolean(pending) || !text.trim()}>{lock ? `Ask the ${NAME[lock]}` : 'Ask'}</button>
      </form>
    </div>
  );
}

// The dock: the team's conversation, always one click away at the foot of the studio. Folded, it is a line
// that says what the team can see; open, it is the chat about the page, or about the open piece.
export function TeamDock({ pid, team, view, hint, subject, lock, open, onOpen, onClose, onLock, reload, onOpenItem }: { pid: string; team: TeamView; view: ContentView; hint: string; subject?: Subject; lock?: AgentId; open: boolean; onOpen: () => void; onClose: () => void; onLock: (a: AgentId | undefined) => void; reload: () => Promise<void>; onOpenItem: (id: string) => void }) {
  const w = team.working && team.agents.find(a => a.id === team.working!.agent);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) {
    const starter = startersFor(team, view, subject, hint)[0];
    return (
      <button className="dock folded" onClick={onOpen} aria-label="Open the team's conversation">
        <span className="stack-av">{AGENTS.map(a => <Avatar key={a} id={a} state={agentState(team, a)} size={26} />)}</span>
        <span className="dock-text"><b>{w ? `${w.name} is working…` : subject ? `Ask about “${cut(subject.label, 32)}”` : 'Ask the team'}</b><small>{starter ? `e.g. ${starter.text}` : 'Whoever knows answers.'}</small></span>
        <span className="dock-key">↵</span>
      </button>
    );
  }
  return (
    <aside className="dock open" aria-label="The team's conversation">
      <header className="dock-head">
        <div><b>{subject ? `About “${cut(subject.label, 44)}”` : 'The team'}</b><small>{subject ? 'The agents already see it: just ask.' : 'One question, the right agent answers. Offers wait for your click.'}</small></div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </header>
      <TeamChat pid={pid} team={team} view={view} base="team" subject={subject} lock={lock} hint={hint} reload={reload} onLock={onLock} onOpenItem={onOpenItem} tall />
    </aside>
  );
}
