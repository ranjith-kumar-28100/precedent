import { AlertTriangle, Check, Copy, Mail, RotateCw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import type { VerifyDraft, VerifyItem } from '../lib/types'
import { Button, ErrorBanner, cx, inputCls } from './ui'
import { useAppData } from '../lib/hooks'

/** "Verify before you trust": claims the brief should not rely on until the vendor confirms them.
 *  Draft a confirmation email (never sent from here), paste the reply, save it to memory, re-run. */
export function VerifyCard({ vendorId, items, onRerun }: { vendorId: string; items: VerifyItem[]; onRerun: () => void }) {
  const { refreshHealth } = useAppData()
  const [draft, setDraft] = useState<VerifyDraft | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [reply, setReply] = useState('')
  const [claim, setClaim] = useState(items[0]?.claim ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  const makeDraft = async () => {
    setDrafting(true); setError(null)
    try { setDraft(await api<VerifyDraft>('/verify/draft', { vendor_id: vendorId, items: items.map((i) => ({ claim: i.claim, ask: i.ask })) })) }
    catch (e) { setError((e as Error).message) }
    finally { setDrafting(false) }
  }
  const copy = async () => {
    if (!draft) return
    const text = `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { setError('Copy is blocked in this browser. Select the text and copy it manually.') }
  }
  const save = async () => {
    setState('saving'); setError(null)
    try {
      await api('/verify/confirm', { vendor_id: vendorId, claim, answer: reply.trim(), source: 'vendor email' })
      setState('saved'); refreshHealth()
    } catch (e) { setState('idle'); setError((e as Error).message) }
  }

  return (
    <section aria-label="Needs verification" className="rounded-lg border border-warn/40 bg-warn/5 p-3">
      <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-warn">
        <AlertTriangle size={13} aria-hidden />Needs verification · {items.length}
      </div>
      <p className="mt-1 text-xs leading-5 text-muted">Don't rely on these until the vendor confirms them.</p>
      <ul className="mt-2 space-y-2">
        {items.map((it, i) => (
          <li key={i} className="rounded-md border border-line bg-panel px-3 py-2">
            <div className="text-[13px] font-medium">{it.claim}</div>
            <div className="mt-0.5 text-xs leading-5 text-muted"><span className="font-medium text-fg">Why: </span>{it.reason}</div>
            <div className="num mt-0.5 text-xs text-muted"><span className="font-medium text-fg">Last evidence: </span>{it.last_evidence_date ?? 'none'}</div>
            {it.ask && <div className="mt-0.5 text-xs leading-5 text-muted"><span className="font-medium text-fg">Ask: </span>{it.ask}</div>}
          </li>
        ))}
      </ul>

      {error && <div className="mt-2"><ErrorBanner error={error} /></div>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={makeDraft} disabled={drafting}><Mail size={13} />{drafting ? 'Drafting…' : draft ? 'Redraft' : 'Draft confirmation to vendor'}</Button>
      </div>

      {draft && (
        <div className="mt-3 space-y-2 rounded-md border border-line bg-panel p-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <div><span className="text-faint">To: </span><span className="font-medium">{draft.to}</span></div>
              <div><span className="text-faint">Subject: </span><span className="font-medium">{draft.subject}</span></div>
            </div>
            <Button size="sm" variant="ghost" onClick={copy} aria-label="Copy email">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</Button>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-[12.5px] leading-5">{draft.body}</pre>
          <p className="text-2xs text-faint">Nothing is sent from Precedent. Copy it into your email.</p>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {items.length > 1 && (
          <label className="block text-xs">
            <span className="text-muted">Which claim did they confirm?</span>
            <select className={cx(inputCls, 'mt-1')} value={claim} onChange={(e) => setClaim(e.target.value)}>
              {items.map((it) => <option key={it.claim} value={it.claim}>{it.claim}</option>)}
            </select>
          </label>
        )}
        <label className="block text-xs">
          <span className="text-muted">Paste their reply</span>
          <textarea className={cx(inputCls, 'mt-1 h-20 py-2')} value={reply} onChange={(e) => { setReply(e.target.value); setState('idle') }}
            placeholder="e.g. Yes, from January any discount above 12% also needs our CFO, Marcus Lindqvist." />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={save} disabled={reply.trim().length < 3 || state === 'saving'}>
            <ShieldCheck size={13} />{state === 'saving' ? 'Saving…' : 'Save as verified'}
          </Button>
          {state === 'saved' && (<>
            <span role="status" className="text-xs text-ok">Saved to Hindsight as a verified fact.</span>
            <Button size="sm" onClick={onRerun}><RotateCw size={13} />Re-run brief</Button>
          </>)}
        </div>
      </div>
    </section>
  )
}
