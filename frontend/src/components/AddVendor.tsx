import { X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, api } from '../lib/api'
import { useAppData } from '../lib/hooks'
import type { NewVendor, Vendor } from '../lib/types'
import { Button, Card, CardHeader, cx, inputCls } from './ui'

type Form = { name: string; category: string; contact: string; price: string; notes: string }
const blank: Form = { name: '', category: '', contact: '', price: '', notes: '' }
const NOTES_MAX = 1000

/** "120,000", "$120 000" and "120000" all mean 120000; anything else that is not a whole number is NaN. */
const parsePrice = (s: string) => {
  const t = s.replace(/[\s,$]/g, '')
  return /^\d+$/.test(t) ? Number(t) : NaN
}

function validate(f: Form, existing: Vendor[]): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {}
  const name = f.name.trim(), category = f.category.trim(), price = parsePrice(f.price)
  if (name.length < 2) e.name = 'Enter at least 2 characters.'
  else if (name.length > 80) e.name = 'Keep it to 80 characters or fewer.'
  else if (existing.some((v) => v.name.trim().toLowerCase() === name.toLowerCase())) e.name = 'A vendor with this name already exists.'
  if (category.length < 2) e.category = 'Enter at least 2 characters.'
  else if (category.length > 60) e.category = 'Keep it to 60 characters or fewer.'
  if (f.contact.trim().length > 120) e.contact = 'Keep it to 120 characters or fewer.'
  if (!f.price.trim()) e.price = 'Enter the annual list price.'
  else if (!Number.isSafeInteger(price) || price <= 0) e.price = 'Use a whole number of dollars above 0.'
  if (f.notes.length > NOTES_MAX) e.notes = `Keep it to ${NOTES_MAX} characters or fewer.`
  return e
}

function serverMessage(e: unknown, name: string): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return `A vendor named “${name}” already exists.`
    if (e.status === 502) return `Hindsight could not save the vendor, so it was not added. ${e.detail}`
    if (e.status === 422) return `The server rejected the form: ${e.detail}`
    return e.detail || e.message
  }
  return String((e as Error)?.message ?? e)
}

/** Inline panel for POST /vendors. Calls `onAdded` with the created vendor; the parent closes it. */
export function AddVendorPanel({ id, onClose, onAdded }: { id?: string; onClose: () => void; onAdded: (v: Vendor) => void }) {
  const { vendors, refreshVendors, refreshHealth } = useAppData()
  const [f, setF] = useState<Form>(blank)
  const [touched, setTouched] = useState<Partial<Record<keyof Form, boolean>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  const uid = useId()
  const categories = useMemo(() => [...new Set(vendors.map((v) => v.category))].sort(), [vendors])
  const errors = useMemo(() => validate(f, vendors), [f, vendors])
  const valid = Object.keys(errors).length === 0

  useEffect(() => { first.current?.focus() }, [])

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const blur = (k: keyof Form) => () => setTouched((t) => ({ ...t, [k]: true }))
  const shown = (k: keyof Form) => (touched[k] ? errors[k] : undefined)

  const submit = async () => {
    setTouched({ name: true, category: true, contact: true, price: true, notes: true })
    if (!valid || saving) return
    setSaving(true); setError(null)
    const body: NewVendor = { name: f.name.trim(), category: f.category.trim(), list_price_usd_annual: parsePrice(f.price) }
    if (f.contact.trim()) body.contact = f.contact.trim()
    if (f.notes.trim()) body.notes = f.notes.trim()
    try {
      const v = await api<Vendor>('/vendors', body)
      refreshVendors(); refreshHealth()
      onAdded(v)
    } catch (e) {
      setError(serverMessage(e, body.name))
      setSaving(false)
    }
  }

  return (
    <Card>
      <div id={id}>
        <CardHeader title="Add vendor" sub="Creates the vendor and its Hindsight memory. It starts with no negotiation history."
          right={<Button size="sm" variant="ghost" onClick={onClose} aria-label="Close add vendor form"><X size={14} /></Button>} />
        <form noValidate className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => { e.preventDefault(); submit() }}
          onKeyDown={(e) => { if (e.key === 'Escape' && !saving) { e.stopPropagation(); onClose() } }}>
          <Row id={`${uid}-name`} label="Name" error={shown('name')}>
            {(p) => <input {...p} ref={first} className={inputCls} value={f.name} onChange={set('name')} onBlur={blur('name')}
              maxLength={80} autoComplete="off" placeholder="e.g. Baltic Packaging OÜ" required />}
          </Row>
          <Row id={`${uid}-cat`} label="Category" error={shown('category')}>
            {(p) => <>
              <input {...p} list={`${uid}-cats`} className={inputCls} value={f.category} onChange={set('category')} onBlur={blur('category')}
                maxLength={60} autoComplete="off" placeholder="Pick or type a category" required />
              <datalist id={`${uid}-cats`}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </>}
          </Row>
          <Row id={`${uid}-contact`} label="Contact (optional)" error={shown('contact')}>
            {(p) => <input {...p} className={inputCls} value={f.contact} onChange={set('contact')} onBlur={blur('contact')}
              maxLength={120} autoComplete="off" placeholder="e.g. Jane Doe, Account Manager" />}
          </Row>
          <Row id={`${uid}-price`} label="Annual list price (USD)" error={shown('price')}>
            {(p) => <input {...p} className={cx(inputCls, 'num')} inputMode="numeric" value={f.price} onChange={set('price')} onBlur={blur('price')}
              autoComplete="off" placeholder="e.g. 120000" required />}
          </Row>
          <Row id={`${uid}-notes`} label="What we already know (optional)" error={shown('notes')} className="sm:col-span-2 lg:col-span-4"
            hint={<span className="flex justify-between gap-3">
              <span>Saved to Hindsight as the vendor’s first memory. Leave blank to start from zero.</span>
              <span className={cx('num shrink-0 font-mono', f.notes.length > NOTES_MAX && 'text-bad')}>{f.notes.length}/{NOTES_MAX}</span>
            </span>}>
            {(p) => <textarea {...p} className={cx(inputCls, 'h-20 py-2')} value={f.notes} onChange={set('notes')} onBlur={blur('notes')}
              placeholder="Who signs off on discounts, past pricing, how they negotiate…" />}
          </Row>
          {error && <p role="alert" className="text-xs text-bad sm:col-span-2 lg:col-span-4">{error}</p>}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
            <Button variant="primary" type="submit" disabled={saving || !valid} aria-busy={saving}>
              {saving ? 'Adding and retaining…' : 'Add vendor and retain to memory'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            {f.notes.trim() && <span className="ml-auto text-2xs text-faint">Uses the LLM for fact extraction</span>}
          </div>
        </form>
      </div>
    </Card>
  )
}

type CtlProps = { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }

/** Label + control + hint/error, with the control linked to both by id. */
function Row({ id, label, error, hint, className, children }: {
  id: string; label: string; error?: string; hint?: ReactNode; className?: string; children: (p: CtlProps) => ReactNode
}) {
  const desc = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-2xs font-medium uppercase tracking-wider text-faint">{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': desc })}
      {hint && <div id={`${id}-hint`} className="text-2xs text-muted">{hint}</div>}
      {error && <div id={`${id}-err`} className="text-2xs text-bad">{error}</div>}
    </div>
  )
}
