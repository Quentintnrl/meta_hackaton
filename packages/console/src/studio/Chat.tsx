import { useEffect, useRef, useState } from 'react';
import { teamApi, type AgentId, type ChatMessage, type SuggestedAction } from '../api';
import { ago } from './shared';

const NAME: Record<AgentId, string> = { director: 'Director', scout: 'Scout', analyst: 'Analyst', strategist: 'Strategist', writer: 'Writer' };

// A conversation with one member of the team. Suggested actions appear as buttons: nothing happens until the manager clicks.
export function Chat({ pid, agent, reload, goAgent, placeholder, starters }: { pid: string; agent: AgentId; reload: () => Promise<void>; goAgent: (a: AgentId) => void; placeholder: string; starters: string[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Set<string>>(new Set());
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages([]); teamApi.chat(pid, agent).then(setMessages).catch(() => {}); }, [pid, agent]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, busy]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setBusy(true); setError(''); setText('');
    setMessages(m => [...m, { id: -1, thread: agent, role: 'user', text: message, actions: [], at: new Date().toISOString() }]);
    try { setMessages(await teamApi.say(pid, agent, message)); } catch (e) { setError((e as Error).message); setMessages(await teamApi.chat(pid, agent).catch(() => [])); } finally { setBusy(false); }
  }

  async function confirm(key: string, a: SuggestedAction) {
    if (a.kind === 'talk') { if (a.agent) goAgent(a.agent); return; }
    try { await teamApi.apply(pid, a); setDone(d => new Set(d).add(key)); await reload(); } catch (e) { setError((e as Error).message); }
  }

  const describe = (a: SuggestedAction) => a.kind === 'run' ? `${(a.agents ?? []).map(x => NAME[x]).join(' → ')}${a.brief ? `: “${a.brief}”` : ''}`
    : a.kind === 'configure' ? [a.agent && NAME[a.agent], a.enabled === undefined ? '' : a.enabled ? 'on' : 'off', a.workers ? `${a.workers} at once` : '', a.instructions ? `new behaviour: “${a.instructions}”` : ''].filter(Boolean).join(' · ') : '';

  return (
    <div className="chat">
      <div className="msgs" role="log" aria-live="polite">
        {messages.length === 0 && <div className="chat-empty"><p className="hint">Start the conversation:</p><div className="chips">{starters.map(s => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}</div></div>}
        {messages.map((m, i) => (
          <div key={`${m.id}-${i}`} className={`msg ${m.role}`}>
            <div className="bubble">{m.text}</div>
            {m.actions.length > 0 && <div className="suggest">{m.actions.map((a, j) => {
              const key = `${m.id}-${j}`;
              return (
                <button key={key} className={a.kind === 'talk' ? 'sug talk' : 'sug'} disabled={done.has(key)} onClick={() => confirm(key, a)} title={describe(a)}>
                  <b>{done.has(key) ? '✓ Done' : a.kind === 'talk' ? `${a.label} →` : a.label}</b>{a.kind !== 'talk' && <span>{describe(a)}</span>}
                </button>
              );
            })}</div>}
            {m.id > 0 && <time>{ago(m.at)}</time>}
          </div>
        ))}
        {busy && <div className="msg agent"><div className="bubble typing"><i /><i /><i /></div></div>}
        <div ref={end} />
      </div>
      {error && <p className="error">{error}</p>}
      <form className="composer" onSubmit={e => { e.preventDefault(); void send(text); }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} aria-label={`Message the ${NAME[agent]}`} />
        <button className="primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}
