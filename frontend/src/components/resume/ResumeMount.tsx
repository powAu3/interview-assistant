import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { FileText, Loader2, Upload, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { api } from '@/lib/api'
import { refreshConfig } from '@/lib/configSync'
import { ResumeHistoryPanel, ResumeHistoryPopover } from '@/components/ResumeHistory'
import { useInterviewStore } from '@/stores/configStore'

function useResumeMountState() {
  const { config, setToastMessage } = useInterviewStore(
    useShallow((s) => ({
      config: s.config,
      setToastMessage: s.setToastMessage,
    })),
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pendingFilename, setPendingFilename] = useState<string | null>(null)

  useEffect(() => {
    if (!config?.has_resume || config?.resume_active_filename) {
      setPendingFilename(null)
    }
  }, [config?.has_resume, config?.resume_active_filename])

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)
    setPendingFilename(file.name)
    try {
      const result = await api.uploadResume(file)
      await refreshConfig()
      if (result.parsed) {
        setToastMessage('简历已解析并选用')
      } else {
        setUploadError(`已保存到历史，解析未成功：${result.parse_error || '可在历史中「选用」重试解析'}`)
        setToastMessage('文件已保存，可在历史中「选用」重试解析')
      }
    } catch (err) {
      setPendingFilename(null)
      const message = err instanceof Error ? err.message : '上传失败'
      setUploadError(message)
      setToastMessage(message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleRemove = async () => {
    setUploadError(null)
    setPendingFilename(null)
    try {
      await api.deleteResume()
      await refreshConfig()
      setToastMessage('已移除当前挂载简历')
    } catch (err) {
      const message = err instanceof Error ? err.message : '移除失败'
      setUploadError(message)
      setToastMessage(message)
    }
  }

  return {
    fileRef,
    config,
    uploading,
    uploadError,
    clearUploadError: () => setUploadError(null),
    hasResume: Boolean(config?.has_resume),
    activeFilename: pendingFilename || config?.resume_active_filename || null,
    activeHistoryId: config?.resume_active_history_id ?? null,
    handleUpload,
    handleRemove,
  }
}

export function ResumeMountInline({
  className = '',
}: {
  className?: string
}) {
  const {
    fileRef,
    uploading,
    hasResume,
    activeFilename,
    handleUpload,
    handleRemove,
  } = useResumeMountState()

  return (
    <div
      className={`hidden md:inline-flex items-stretch flex-shrink-0 rounded-lg border bg-bg-tertiary overflow-visible ${
        uploading || hasResume ? 'border-bg-hover' : 'border-dashed border-bg-hover/90'
      } ${className}`}
      data-testid="resume-mount-inline"
    >
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.txt,.md,.doc,.docx"
        onChange={handleUpload}
        className="hidden"
      />
      {uploading ? (
        <div className="flex items-center gap-1 pl-2 pr-1 py-2 text-xs text-text-muted rounded-l-lg">
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
          <span className="hidden sm:inline">解析中…</span>
        </div>
      ) : hasResume ? (
        <div className="flex items-center gap-1 pl-2 pr-1 py-2 text-xs rounded-l-lg min-w-0 max-w-[220px]">
          <FileText className="w-3.5 h-3.5 text-accent-green flex-shrink-0" />
          <span
            className="text-text-secondary truncate hidden sm:inline"
            data-testid="resume-mount-inline-filename"
          >
            {activeFilename || '简历已上传'}
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-accent-blue text-[10px] hover:underline hidden sm:inline flex-shrink-0"
          >
            更换
          </button>
          <button
            type="button"
            onClick={handleRemove}
            className="inline-flex items-center justify-center min-h-[32px] min-w-[32px] rounded-md text-text-muted hover:text-accent-red hover:bg-bg-hover/60 transition-colors flex-shrink-0"
            aria-label="移除已上传的简历"
            title="移除简历 (仅取消挂载,不会删除历史文件)"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 pl-2 pr-1 py-2 text-text-secondary text-xs transition-colors rounded-l-lg hover:bg-bg-hover/60"
        >
          <Upload className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="hidden sm:inline whitespace-nowrap">简历</span>
        </button>
      )}
      <div className="w-px shrink-0 bg-bg-hover/70 self-stretch my-1" aria-hidden />
      <ResumeHistoryPopover />
    </div>
  )
}

export function ResumeMountPanel({
  title,
  description,
  statusLabel,
  emptyHint,
  sharedNote,
  historyMode = 'panel',
  className = '',
}: {
  title: string
  description: string
  statusLabel?: string
  emptyHint?: string
  sharedNote?: string
  historyMode?: 'panel' | 'popover'
  className?: string
}) {
  const {
    fileRef,
    uploading,
    uploadError,
    clearUploadError,
    hasResume,
    activeFilename,
    activeHistoryId,
    handleUpload,
    handleRemove,
  } = useResumeMountState()

  return (
    <section
      className={`rounded-2xl border border-bg-hover/40 bg-bg-secondary/60 p-4 space-y-3 ${className}`}
      data-testid="resume-mount-panel"
    >
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.txt,.md,.doc,.docx"
        onChange={handleUpload}
        className="hidden"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.16em] text-accent-blue">{title}</p>
          <p className="mt-1 text-sm text-text-primary">{description}</p>
          {sharedNote && <p className="mt-2 text-[11px] text-text-muted">{sharedNote}</p>}
        </div>
        <span className={`rounded-full px-3 py-1 text-[11px] ${
          hasResume
            ? 'bg-accent-green/10 text-accent-green border border-accent-green/20'
            : 'bg-bg-primary/60 text-text-secondary border border-bg-hover/50'
        }`}>
          {statusLabel || (hasResume ? '已挂载' : '待挂载')}
        </span>
      </div>

      <div className={`rounded-xl border px-3 py-3 text-xs ${
        hasResume
          ? 'border-accent-green/20 bg-accent-green/5 text-text-primary'
          : 'border-dashed border-bg-hover/60 bg-bg-primary/40 text-text-muted'
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${hasResume ? 'text-accent-green' : 'text-text-muted'}`} />
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate" data-testid="resume-mount-filename">
              {activeFilename || emptyHint || '当前没有挂载简历'}
            </p>
            <p className="mt-1 text-[11px] text-text-muted">
              {hasResume
                ? `当前挂载记录 ID：${activeHistoryId ?? '—'}`
                : '上传或从历史中选用一份简历后，主流程、模拟练习和简历优化都会一起切换。'}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-lg bg-accent-blue text-white text-xs font-medium px-3 py-2 hover:bg-accent-blue/90 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {hasResume ? (uploading ? '替换中...' : '替换简历') : (uploading ? '上传中...' : '上传简历')}
        </button>
        {hasResume && (
          <button
            type="button"
            onClick={handleRemove}
            className="inline-flex items-center gap-1.5 rounded-lg border border-bg-hover/60 px-3 py-2 text-xs text-text-secondary hover:text-accent-red hover:bg-accent-red/5"
          >
            <X className="w-3.5 h-3.5" />
            取消挂载
          </button>
        )}
        {historyMode === 'popover' && <ResumeHistoryPopover />}
      </div>

      {uploadError && (
        <div className="flex items-center gap-2 bg-accent-red/10 text-accent-red text-xs px-3 py-2 rounded-lg">
          <span className="flex-1">{uploadError}</span>
          <button type="button" onClick={clearUploadError}><X className="w-3 h-3" /></button>
        </div>
      )}

      {historyMode === 'panel' && <ResumeHistoryPanel />}
    </section>
  )
}
