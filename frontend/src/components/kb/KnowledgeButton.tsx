import { BookOpen } from 'lucide-react'
import { useKbStore } from '@/stores/kbStore'
import BetaBadge from './BetaBadge'

interface KnowledgeButtonProps {
  className?: string
}

export default function KnowledgeButton({ className = '' }: KnowledgeButtonProps) {
  const toggleDrawer = useKbStore((s) => s.toggleDrawer)
  return (
    <button
      type="button"
      onClick={toggleDrawer}
      title="知识库 (Beta) — 让答案引用你的本地笔记"
      aria-label="打开知识库 Beta"
      className={`relative p-1.5 rounded-xl hover:bg-bg-tertiary/60 text-text-muted hover:text-amber-400 transition-all duration-200 border border-transparent hover:border-amber-500/30 flex items-center gap-1.5 ${className}`}
    >
      <BookOpen className="w-4 h-4" />
      <BetaBadge className="hidden sm:inline-flex" />
    </button>
  )
}
