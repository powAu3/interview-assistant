import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

export function WsReconnectingBanner() {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  const allowReload = elapsed >= 10
  const handleReload = () => {
    if (window.confirm('刷新页面将丢失当前转录与未保存的对话,确定继续?')) {
      window.location.reload()
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-xs text-accent-amber bg-accent-amber/10 px-3 py-1.5 rounded-lg"
    >
      <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
      <span>
        连接已断开 ({elapsed}s), 正在自动重连…
      </span>
      {allowReload && (
        <button
          type="button"
          onClick={handleReload}
          className="ml-auto text-accent-blue hover:underline font-medium"
          title="长时间未恢复时,手动刷新页面 (会丢失当前对话)"
        >
          手动刷新
        </button>
      )}
    </div>
  )
}
