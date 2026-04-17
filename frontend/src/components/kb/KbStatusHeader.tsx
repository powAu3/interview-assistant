import { useKbStore } from '@/stores/kbStore'

const DEP_LABELS: Record<string, string> = {
  docx: 'DOCX',
  pdf: 'PDF',
  ocr: 'OCR',
  vision: 'Vision',
}

export default function KbStatusHeader() {
  const status = useKbStore((s) => s.status)
  if (!status) {
    return (
      <div className="mx-1 mb-2 px-2 py-1.5 rounded-lg bg-bg-tertiary/40 text-[11px] text-text-muted">
        加载状态中…
      </div>
    )
  }

  const enabledColor = status.enabled
    ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
    : 'border-bg-hover/60 bg-bg-tertiary/40 text-text-muted'

  return (
    <div className="mx-1 mb-2 px-2.5 py-2 rounded-lg border border-bg-hover/40 bg-bg-tertiary/40">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${enabledColor}`}
          >
            {status.enabled ? '已开启' : '未开启'}
          </span>
          <span className="text-[10px] text-text-muted">
            {status.total_docs} 文档 · {status.total_chunks} 切片
          </span>
        </div>
        <div className="text-[10px] text-text-muted">
          deadline {status.deadline_ms}ms / ASR {status.asr_deadline_ms}ms
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {Object.entries(status.deps).map(([k, v]) => (
          <span
            key={k}
            title={v ? `${DEP_LABELS[k] ?? k} 已就绪` : `${DEP_LABELS[k] ?? k} 未启用 / 未安装`}
            className={`text-[10px] px-1.5 py-0.5 rounded-md border ${
              v
                ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
                : 'border-bg-hover/60 bg-bg-tertiary/40 text-text-muted'
            }`}
          >
            {DEP_LABELS[k] ?? k}
          </span>
        ))}
      </div>
      {!status.enabled && (
        <p className="mt-1.5 text-[10px] text-text-muted leading-snug">
          要启用,请在 <code className="text-[10px] bg-bg-tertiary px-0.5 rounded">backend/config.json</code> 设置
          <code className="text-[10px] bg-bg-tertiary px-0.5 rounded">kb_enabled: true</code> 后重启后端。
        </p>
      )}
    </div>
  )
}
