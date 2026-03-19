import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { X } from 'lucide-react'
import type { Application, Offer } from './types'

type Props = {
  open: boolean
  application: Application | null
  offer: Offer | null
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => Promise<void>
}

export default function OfferEditModal({ open, application, offer, onClose, onSave }: Props) {
  const [baseSalary, setBaseSalary] = useState('')
  const [totalPkg, setTotalPkg] = useState('')
  const [bonus, setBonus] = useState('')
  const [equity, setEquity] = useState('')
  const [benefitsText, setBenefitsText] = useState('')
  const [wfh, setWfh] = useState('')
  const [location, setLocation] = useState('')
  const [pros, setPros] = useState('')
  const [cons, setCons] = useState('')
  const [deadline, setDeadline] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !application) return
    if (offer) {
      setBaseSalary(offer.base_salary)
      setTotalPkg(offer.total_pkg_note)
      setBonus(offer.bonus)
      setEquity(offer.equity)
      setBenefitsText((offer.benefits || []).join('\n'))
      setWfh(offer.wfh)
      setLocation(offer.location)
      setPros(offer.pros)
      setCons(offer.cons)
      setDeadline(offer.deadline != null ? dayjs.unix(Math.floor(offer.deadline)).format('YYYY-MM-DD') : '')
    } else {
      setBaseSalary('')
      setTotalPkg('')
      setBonus('')
      setEquity('')
      setBenefitsText('')
      setWfh('')
      setLocation(application.city || '')
      setPros('')
      setCons('')
      setDeadline('')
    }
  }, [open, application, offer])

  if (!open || !application) return null

  const submit = async () => {
    setSaving(true)
    try {
      const benefits = benefitsText
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
      await onSave({
        application_id: application.id,
        base_salary: baseSalary,
        total_pkg_note: totalPkg,
        bonus,
        equity,
        benefits,
        wfh,
        location,
        pros,
        cons,
        deadline: deadline ? dayjs(deadline).unix() : null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-bg-hover bg-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-hover">
          <div>
            <h2 className="text-sm font-bold text-text-primary">Offer 详情</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {application.company} · {application.position}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-bg-tertiary text-text-muted"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="月薪 / 基数">
            <input
              className="input-jt"
              value={baseSalary}
              onChange={(e) => setBaseSalary(e.target.value)}
              placeholder="如 35k×16"
            />
          </Field>
          <Field label="总包说明">
            <input className="input-jt" value={totalPkg} onChange={(e) => setTotalPkg(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="奖金">
              <input className="input-jt" value={bonus} onChange={(e) => setBonus(e.target.value)} />
            </Field>
            <Field label="股权">
              <input className="input-jt" value={equity} onChange={(e) => setEquity(e.target.value)} />
            </Field>
          </div>
          <Field label="福利（每行一条）">
            <textarea
              className="input-jt min-h-[72px] resize-y"
              value={benefitsText}
              onChange={(e) => setBenefitsText(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="办公 / 远程">
              <input className="input-jt" value={wfh} onChange={(e) => setWfh(e.target.value)} />
            </Field>
            <Field label="工作地点">
              <input className="input-jt" value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
          </div>
          <Field label="优点">
            <textarea className="input-jt min-h-[56px]" value={pros} onChange={(e) => setPros(e.target.value)} />
          </Field>
          <Field label="顾虑">
            <textarea className="input-jt min-h-[56px]" value={cons} onChange={(e) => setCons(e.target.value)} />
          </Field>
          <Field label="答复截止">
            <input
              type="date"
              className="input-jt"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-bg-hover bg-bg-tertiary/20">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs rounded-xl border border-bg-hover hover:bg-bg-tertiary">
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="px-4 py-2 text-xs rounded-xl bg-accent-blue text-white font-medium disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
      <style>{`
        .input-jt {
          width: 100%;
          background: #1a1a24;
          color: #e2e8f0;
          font-size: 0.75rem;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          border: 1px solid #24243a;
          outline: none;
        }
        .input-jt:focus { border-color: #6366f1; }
      `}</style>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}
