import { Loader2, CheckCircle2, XCircle } from 'lucide-react'

export function Section({ title, icon, children }: { title: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-text-secondary">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-text-muted leading-tight">{hint}</p>}
    </div>
  )
}

export function GradientCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-bg-hover/60 bg-gradient-to-b from-bg-tertiary/20 to-bg-secondary/30 backdrop-blur-sm ${className}`}>
      {children}
    </div>
  )
}

export function StatusBadge({ status, label }: { status: 'ok' | 'error' | 'checking' | 'idle'; label: string }) {
  const styles = {
    ok: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    error: 'bg-red-500/15 text-red-400 border-red-500/20',
    checking: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    idle: 'bg-bg-hover text-text-muted border-bg-hover',
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium border ${styles[status]}`}>
      {status === 'checking' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {status === 'ok' && <CheckCircle2 className="w-2.5 h-2.5" />}
      {status === 'error' && <XCircle className="w-2.5 h-2.5" />}
      {label}
    </span>
  )
}

export const INPUT_FIELD_STYLE = `
  .input-field {
    width: 100%;
    background: rgb(var(--c-bg-tertiary));
    color: rgb(var(--c-text-primary));
    font-size: 0.75rem;
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid rgb(var(--c-bg-hover));
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .input-field:focus {
    border-color: rgb(var(--c-accent-blue));
    box-shadow: 0 0 0 2px rgb(var(--c-accent-blue) / 0.1);
  }
`
