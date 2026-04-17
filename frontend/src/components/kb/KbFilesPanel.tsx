import { useRef, useState } from 'react'
import { Upload, Trash2, RefreshCw, FileText, FileType2 } from 'lucide-react'
import { useKbStore } from '@/stores/kbStore'
import { api } from '@/lib/api'

interface Props {
  onChanged: () => void | Promise<void>
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function fmtMtime(ts: number): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString()
}

function loaderIcon(loader: string) {
  if (loader === 'pdf') return <FileType2 className="w-3.5 h-3.5 text-rose-400" />
  if (loader === 'docx') return <FileText className="w-3.5 h-3.5 text-blue-400" />
  return <FileText className="w-3.5 h-3.5 text-text-muted" />
}

export default function KbFilesPanel({ onChanged }: Props) {
  const docs = useKbStore((s) => s.docs)
  const [uploading, setUploading] = useState(false)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      await api.kbUpload(file, '')
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (path: string) => {
    if (!confirm(`确定删除 ${path}? 文件和索引都会被移除。`)) return
    setBusyPath(path)
    setError(null)
    try {
      await api.kbDelete(path)
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusyPath(null)
    }
  }

  const handleReindex = async () => {
    setBusyPath('__reindex__')
    setError(null)
    try {
      await api.kbReindex()
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : '重建失败')
    } finally {
      setBusyPath(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
        >
          <Upload className="w-3.5 h-3.5" />
          {uploading ? '上传中…' : '上传文件'}
        </button>
        <button
          type="button"
          onClick={handleReindex}
          disabled={busyPath === '__reindex__'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-bg-tertiary border border-bg-hover/40 text-text-muted hover:text-text-primary disabled:opacity-50"
          title="重建全量索引 (按 mtime 增量)"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busyPath === '__reindex__' ? 'animate-spin' : ''}`} />
          重建索引
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".md,.txt,.log,.docx,.pdf"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleUpload(f)
          }}
        />
      </div>

      <p className="text-[10px] text-text-muted leading-snug">
        支持 .md / .txt / .log / .docx / .pdf。<span className="text-amber-400">不支持 .doc</span>,请在 Word 中另存为 .docx。
      </p>

      {error && (
        <div className="px-2 py-1.5 rounded-lg border border-accent-red/30 bg-accent-red/10 text-[11px] text-accent-red">
          {error}
        </div>
      )}

      {docs.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-xs">
          还没有文档,上传一个 .md / .pdf / .docx 试试。
        </div>
      ) : (
        <ul className="space-y-1.5">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-bg-hover/30 bg-bg-tertiary/30 hover:bg-bg-tertiary/60 transition-colors"
            >
              <span className="flex-shrink-0">{loaderIcon(d.loader)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-text-primary font-medium truncate" title={d.path}>
                    {d.path}
                  </span>
                  {d.status === 'failed' && (
                    <span
                      title={d.error ?? ''}
                      className="text-[9px] px-1 py-0 rounded border border-accent-red/40 bg-accent-red/10 text-accent-red"
                    >
                      失败
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-text-muted truncate">
                  {d.chunk_count} 切片 · {fmtSize(d.size)} · {fmtMtime(d.mtime)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(d.path)}
                disabled={busyPath === d.path}
                className="p-1 rounded text-text-muted hover:text-accent-red hover:bg-accent-red/10 disabled:opacity-50"
                title="删除"
                aria-label={`删除 ${d.path}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
