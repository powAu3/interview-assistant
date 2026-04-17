import { BookOpen } from 'lucide-react'
import { useKbStore } from '@/stores/kbStore'
import BetaBadge from './BetaBadge'

interface KnowledgeButtonProps {
  className?: string
}

export default function KnowledgeButton({ className = '' }: KnowledgeButtonProps) {
  const toggleDrawer = useKbStore((s) => s.toggleDrawer)
  const status = useKbStore((s) => s.status)
  // KB 开了但还没文档 — 给个一直跳动的红点提示用户来上传, 否则角标永远不出现。
  const needsDocs = !!status?.enabled && (status?.total_docs ?? 0) === 0

  return (
    <button
      type="button"
      onClick={toggleDrawer}
      title={
        needsDocs
          ? '知识库已开启但还没有文档 — 点击上传一篇笔记'
          : '知识库 (Beta) — 让答案引用你的本地笔记'
      }
      aria-label="打开知识库 Beta"
      className={`relative p-1.5 rounded-xl hover:bg-bg-tertiary/60 text-text-muted hover:text-amber-400 transition-all duration-200 border border-transparent hover:border-amber-500/30 flex items-center gap-1.5 ${className}`}
    >
      <BookOpen className="w-4 h-4" />
      <BetaBadge className="hidden sm:inline-flex" />
      {needsDocs && (
        <span
          aria-hidden
          className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-bg-primary animate-pulse"
        />
      )}
    </button>
  )
}
