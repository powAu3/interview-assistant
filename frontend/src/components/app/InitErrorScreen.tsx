import { buildApiUrl } from '@/lib/backendUrl'

export function InitErrorScreen({ initError }: { initError: string }) {
  return (
    <div className="h-full flex items-center justify-center bg-bg-primary px-4">
      <div role="alert" className="w-full max-w-md rounded-xl border border-accent-red/25 bg-bg-secondary/70 p-6 text-center shadow-xl shadow-black/5 space-y-4">
        <div className="space-y-1.5">
          <p className="text-accent-red text-sm font-semibold">连接后端失败</p>
          <p className="text-text-primary text-xs break-words">{initError}</p>
        </div>
        <div className="rounded-lg bg-bg-tertiary/60 border border-bg-hover/50 px-3 py-2 text-left text-[11px] text-text-muted leading-relaxed space-y-1">
          <p>正在请求 {buildApiUrl('/api/config')}</p>
          <p>请确认后端服务已启动；桌面模式可重新运行 python start.py，浏览器模式请检查端口与访问令牌。</p>
        </div>
        <button onClick={() => window.location.reload()} className="px-4 py-2 bg-accent-blue text-white text-xs font-medium rounded-lg hover:opacity-90 transition-opacity">重试连接</button>
      </div>
    </div>
  )
}
