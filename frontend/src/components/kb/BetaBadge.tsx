interface BetaBadgeProps {
  title?: string
  className?: string
}

/**
 * 统一的 BETA 角标 — 全站只用这一个组件
 * 颜色走主题变量 accent-amber:
 *   light: rgb(184 134 11) → 深褐黄, 在白底上对比度足够
 *   dark : rgb(245 158 11) → amber-500, 在深底上不刺眼
 */
export default function BetaBadge({
  title = 'Beta — 功能仍在测试中',
  className = '',
}: BetaBadgeProps) {
  return (
    <span
      title={title}
      aria-label="Beta"
      className={`relative inline-flex items-center px-1.5 py-[1px] text-[9px] leading-none rounded-[5px] font-mono font-semibold tracking-[0.14em] uppercase text-accent-amber border border-accent-amber/45 bg-gradient-to-b from-accent-amber/15 to-accent-amber/[0.04] ${className}`}
    >
      <span
        className="absolute inset-x-1 top-0 h-px bg-gradient-to-r from-transparent via-accent-amber/45 to-transparent"
        aria-hidden
      />
      BETA
    </span>
  )
}
