import { useRef, useState } from 'react'
import { Upload, Trash2, RefreshCw, FileText, FileType2, UploadCloud } from 'lucide-react'
import { useKbStore } from '@/stores/kbStore'
import { useInterviewStore } from '@/stores/configStore'
import { api } from '@/lib/api'

function toast(msg: string) {
  useInterviewStore.getState().setToastMessage(msg)
}

const ACCEPT = '.md,.txt,.log,.docx,.pdf'
const ACCEPT_SET = new Set(['.md', '.txt', '.log', '.docx', '.pdf'])

function isSupported(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return ACCEPT_SET.has(name.slice(dot).toLowerCase())
}

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
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (file: File) => {
    if (!isSupported(file.name)) {
      const msg = `不支持的文件类型: ${file.name}`
      setError(msg)
      toast(msg)
      return
    }
    setUploading(true)
    setError(null)
    try {
      await api.kbUpload(file, '')
      await onChanged()
      toast(`已上传并索引: ${file.name}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '上传失败'
      setError(msg)
      toast(`上传失败: ${msg}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) await handleUpload(f)
  }

  const handleDelete = async (path: string) => {
    if (!confirm(`确定删除 ${path}? 文件和索引都会被移除。`)) return
    setBusyPath(path)
    setError(null)
    try {
      await api.kbDelete(path)
      await onChanged()
      toast(`已删除: ${path}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '删除失败'
      setError(msg)
      toast(`删除失败: ${msg}`)
    } finally {
      setBusyPath(null)
    }
  }

  const handleReindex = async () => {
    setBusyPath('__reindex__')
    setError(null)
    try {
      const r = await api.kbReindex()
      await onChanged()
      toast(`重建完成: 索引 ${Number(r.docs_indexed ?? 0)} / 删除 ${Number(r.docs_deleted ?? 0)}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '重建失败'
      setError(msg)
      toast(`重建失败: ${msg}`)
    } finally {
      setBusyPath(null)
    }
  }

  const hasDocs = docs.length > 0
  const totalChunks = docs.reduce((sum, d) => sum + (d.chunk_count || 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 hover:border-amber-500/50 transition-colors disabled:opacity-50"
        >
          <Upload className="w-3.5 h-3.5" />
          {uploading ? '上传中…' : '上传文件'}
        </button>
        <button
          type="button"
          onClick={handleReindex}
          disabled={busyPath === '__reindex__' || !hasDocs}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-bg-tertiary border border-bg-hover/40 text-text-muted hover:text-text-primary hover:border-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={hasDocs ? '重建全量索引 (按 mtime 增量)' : '还没有文档可重建'}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busyPath === '__reindex__' ? 'animate-spin' : ''}`} />
          重建索引
        </button>
        {hasDocs && (
          <span className="ml-auto text-[10px] text-text-muted tabular-nums">
            {docs.length} 份 · {totalChunks} 切片
          </span>
        )}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept={ACCEPT}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleUpload(f)
          }}
        />
      </div>

      {error && (
        <div className="px-2 py-1.5 rounded-lg border border-accent-red/30 bg-accent-red/10 text-[11px] text-accent-red">
          {error}
        </div>
      )}

      {!hasDocs ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileInputRef.current?.click()
            }
          }}
          className={`group relative cursor-pointer rounded-2xl border-2 border-dashed transition-all px-5 py-10 text-center overflow-hidden focus:outline-none focus:ring-2 focus:ring-amber-400/40 ${
            dragOver
              ? 'border-amber-400/70 bg-gradient-to-b from-amber-400/15 to-amber-500/5 scale-[1.01]'
              : 'border-bg-hover/50 bg-gradient-to-b from-bg-tertiary/30 to-bg-tertiary/10 hover:border-amber-400/50 hover:from-amber-400/8 hover:to-transparent'
          }`}
        >
          <div
            className={`mx-auto mb-3 w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${
              dragOver
                ? 'bg-amber-400/20 scale-110'
                : 'bg-amber-400/10 group-hover:bg-amber-400/15 group-hover:scale-105'
            }`}
          >
            <UploadCloud
              className={`w-7 h-7 transition-colors ${
                dragOver ? 'text-amber-300' : 'text-amber-400/80 group-hover:text-amber-300'
              }`}
              strokeWidth={1.6}
            />
          </div>
          <div className="text-sm font-semibold text-text-primary mb-1">
            {dragOver ? '松开以上传' : '把笔记拖到这里'}
          </div>
          <div className="text-[11px] text-text-muted mb-4">
            或点击选择 · 答题时会以 <span className="text-amber-400/90 font-medium">[角标]</span> 引用并显示来源
          </div>
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            {['.md', '.txt', '.log', '.docx', '.pdf'].map((ext) => (
              <span
                key={ext}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-tertiary/50 border border-bg-hover/40 text-text-secondary"
              >
                {ext}
              </span>
            ))}
            <span className="text-[10px] text-text-muted/70 ml-1">
              · 不支持 .doc
            </span>
          </div>
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
