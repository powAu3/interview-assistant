interface BetaBadgeProps {
  title?: string
  className?: string
}

export default function BetaBadge({
  title = 'Beta — 功能仍在测试中',
  className = '',
}: BetaBadgeProps) {
  return (
    <span
      title={title}
      aria-label="Beta"
      className={`inline-flex items-center px-1.5 py-0 text-[9px] leading-[14px] rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-400 font-semibold tracking-wide ${className}`}
    >
      BETA
    </span>
  )
}
