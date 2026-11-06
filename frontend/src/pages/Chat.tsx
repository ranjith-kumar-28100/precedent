import { ArrowUp, CircleOff, Eraser, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CiteChip, EvidenceDrawer } from '../components/Evidence'
import { LogoMark } from '../components/Logo'
import { Trace } from '../components/Trace'
import { Badge, Button, ErrorBanner, Kbd, Segmented, Skeleton, cx, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { ms } from '../lib/format'
import { useAppData } from '../lib/hooks'
import type { ChatResp } from '../lib/types'

const SUGGS = [
  'Which tactic has backfired most often, and with whom?',
  'Which vendors changed owner or contact recently?',
  'What works best with Kestrel Alloys?',
  'Summarise every vendor where a competing quote beat 15%',
]

type Msg = { role: 'user' | 'assistant'; content: string; resp?: ChatResp }

function Answer({ resp, onCite }: { resp: ChatResp; onCite: (id: string) => void }) {
  const md = resp.answer.replace(/\[(m\d+)\]/g, '[$1](#cite-$1)')
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ href, children }) => href?.startsWith('#cite-')
          ? <CiteChip id={href.slice(6)} onClick={onCite} />
          : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
      }}>{md}</ReactMarkdown>
    </div>
  )
}

export default function Chat() {
  const { vendors, vendorName, refreshHealth } = useAppData()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [mem, setMem] = useState<'on' | 'off'>('on')
  const [scope, setScope] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<{ resp: ChatResp; id: string } | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [msgs, busy])

  const send = async (q = text) => {
    q = q.trim()
    if (!q || busy) return
    const next: Msg[] = [...msgs, { role: 'user', content: q }]
    setMsgs(next); setText(''); setBusy(true); setErr(null)
    try {
      const resp = await api<ChatResp>('/chat', { messages: next.map(({ role, content }) => ({ role, content })), vendor_id: scope || null, use_memory: mem === 'on' })
      setMsgs([...next, { role: 'assistant', content: resp.answer, resp }])
      refreshHealth()
    } catch (e) {
      setErr(String((e as Error).message)); setMsgs(msgs); setText(q)
    } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="Memory" value={mem} onChange={setMem} options={[
          { value: 'on', label: <span className="flex items-center gap-1"><Sparkles size={12} className={mem === 'on' ? 'text-accent' : ''} />Memory ON</span> },
          { value: 'off', label: <span className="flex items-center gap-1"><CircleOff size={12} />Memory OFF</span> }]} />
        <select aria-label="Scope" className={cx(inputCls, '!h-8 !w-52 text-xs')} value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" disabled={!msgs.length || busy} onClick={() => { setMsgs([]); setErr(null) }}><Eraser size={13} />Clear</Button>
      </div>

      <div className="flex-1 space-y-5">
        {!msgs.length && (
          <div className="flex flex-col items-center px-2 pt-8 text-center">
            <LogoMark size={36} />
            <h2 className="mt-3 text-lg font-semibold tracking-tight">Ask the negotiation memory</h2>
            <p className="mt-1 max-w-md text-[13px] text-muted">
              Answers come from Hindsight recall across every vendor, with exact counts from the structured outcome metadata. Every claim cites its memory.
            </p>
            <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
              {SUGGS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-xl border border-line bg-panel px-3.5 py-3 text-left text-[13px] hover:border-accent/40 hover:bg-accent-soft/40">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => m.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13.5px] leading-6 text-accent-fg">{m.content}</div>
          </div>
        ) : (
          <div key={i} className="flex gap-3">
            <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-panel"><LogoMark size={18} /></div>
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={m.resp!.use_memory ? 'accent' : 'neutral'}>{m.resp!.use_memory ? 'Memory ON' : 'Memory OFF'}</Badge>
                {m.resp!.citations.length > 0 && <button onClick={() => setDrawer({ resp: m.resp!, id: m.resp!.citations[0].id })} className="num text-xs font-medium text-accent hover:underline">{m.resp!.citations.length} sources</button>}
                <span className="num font-mono text-2xs text-faint">{ms(m.resp!.latency_ms)}</span>
              </div>
              <Answer resp={m.resp!} onCite={(id) => setDrawer({ resp: m.resp!, id })} />
              <Trace steps={m.resp!.trace} label="Tools used" />
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex gap-3">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-panel"><LogoMark size={18} /></div>
            <div className="flex-1 space-y-2 pt-1"><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-3.5 w-1/2" /><p className="text-xs text-faint">{mem === 'on' ? 'Searching memory…' : 'Thinking without memory…'}</p></div>
          </div>
        )}
        {err && <ErrorBanner error={err} onRetry={() => send()} />}
        <div ref={end} />
      </div>

      <form className="sticky bottom-0 mt-5 bg-gradient-to-t from-bg via-bg to-transparent pb-2 pt-4" onSubmit={(e) => { e.preventDefault(); send() }}>
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel p-2 shadow-card focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
          <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={mem === 'on' ? `Ask about ${scope ? vendorName(scope) : 'any vendor'}…` : 'Memory is off: general advice only'}
            className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] placeholder:text-faint focus:outline-none" />
          <Button variant="primary" type="submit" disabled={!text.trim() || busy} aria-label="Send" className="h-9 w-9 !px-0"><ArrowUp size={16} /></Button>
        </div>
        <p className="mt-1.5 text-center text-2xs text-faint"><Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line</p>
      </form>

      {drawer && <EvidenceDrawer open onClose={() => setDrawer(null)} citations={drawer.resp.citations} active={drawer.id} title="Chat answer" vendorName={vendorName} />}
    </div>
  )
}
