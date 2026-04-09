import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Play,
  Square,
  Trash2,
  Upload,
  Send,
  FileText,
  X,
  AlertTriangle,
  Image as ImageIcon,
  Pause,
  PlayCircle,
  Zap,
  Loader2,
} from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { api } from '@/lib/api'
import { ResumeHistoryPopover } from '@/components/ResumeHistory'

const DEFAULT_QUICK_PROMPTS = [
  '写代码实现',
  '给SQL',
  '时间复杂度',
  '举个例子',
  '更详细',
  '对比区别',
  '优缺点',
  '应用场景',
  '简短回答',
]

const STORAGE_KEY = 'quick_prompts'

function getQuickPrompts(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {}
  return DEFAULT_QUICK_PROMPTS
}

export function saveQuickPrompts(prompts: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts))
}

export { DEFAULT_QUICK_PROMPTS, STORAGE_KEY, getQuickPrompts }

export default function ControlBar() {
  const { isRecording, isPaused, devices, config, platformInfo, clearSession, streamingIds, qaPairs, transcriptions, setToastMessage, lastWSError, setLastWSError, wsConnected, modelHealth } = useInterviewStore()
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null)
  const [manualQuestion, setManualQuestion] = useState('')
  const [pastedImage, setPastedImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [cancellingAsk, setCancellingAsk] = useState(false)
  const [resumeUploading, setResumeUploading] = useState(false)
  const [resumeFile, setResumeFile] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const allModelsUnavailable = config?.models && config.models.length > 0 &&
    config.models.every((_, i) => modelHealth[i] === 'error')
  const showColdStartHint = !isRecording && transcriptions.length === 0 && qaPairs.length === 0
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isComposingRef = useRef(false)
  const [quickPrompts, setQuickPrompts] = useState<string[]>(getQuickPrompts)

  useEffect(() => {
    const onStorage = () => setQuickPrompts(getQuickPrompts())
    window.addEventListener('storage', onStorage)
    window.addEventListener('quick-prompts-updated', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('quick-prompts-updated', onStorage)
    }
  }, [])

  useEffect(() => {
    const name = config?.resume_active_filename
    if (name) setResumeFile(name)
    else if (!config?.has_resume) setResumeFile(null)
  }, [config?.resume_active_filename, config?.has_resume])

  const selectedIsLoopback = devices.find((d) => d.id === selectedDevice)?.is_loopback ?? false
  const hasLoopback = devices.some((d) => d.is_loopback)

  useEffect(() => {
    if (devices.length === 0) {
      if (selectedDevice !== null) setSelectedDevice(null)
      return
    }
    if (selectedDevice !== null && devices.some((d) => d.id === selectedDevice)) return
    const loopback = devices.find((d) => d.is_loopback)
    setSelectedDevice(loopback?.id ?? devices[0].id)
  }, [devices, selectedDevice])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault()
        const file = items[i].getAsFile()
        if (!file) continue
        const store = useInterviewStore.getState()
        const activeModel = store.config?.models?.[store.config?.active_model ?? 0]
        if (activeModel && !activeModel.supports_vision) {
          setError(`当前模型「${activeModel.name}」不支持图片识别，请先切换到带 👁 标记的模型再粘贴截图`)
          return
        }
        const reader = new FileReader()
        reader.onload = (ev) => {
          const result = ev.target?.result as string
          if (result) setPastedImage(result)
        }
        reader.readAsDataURL(file)
        return
      }
    }
  }, [])

  const handleStart = async () => {
    if (selectedDevice === null) { setError('请先选择音频设备'); return }
    setLoading(true); setError(null)
    try { await api.start(selectedDevice) }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }
  const handleStop = async () => {
    if (isRecording && !window.confirm('结束本次面试？将停止录音，当前转录与答案会保留在页面上。')) return
    setLoading(true)
    try { await api.stop() } catch {} finally { setLoading(false) }
  }
  const handlePause = async () => {
    setLoading(true)
    try { await api.pause() } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }
  const handleResume = async () => {
    setLoading(true)
    try { await api.resume(selectedDevice ?? undefined) } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }
  const handleClear = async () => {
    if (qaPairs.length > 0 || transcriptions.length > 0) {
      if (!window.confirm('确定要清空当前页的转录与答案吗？清空后不可恢复。')) return
    }
    setClearing(true)
    try {
      await api.clear()
      clearSession()
      setToastMessage('已清空')
    } catch (e: any) { setError(e.message) }
    finally { setClearing(false) }
  }

  const handleCancelAsk = async () => {
    setCancellingAsk(true)
    try {
      await api.cancelAsk()
      setToastMessage('已发送取消')
    } catch {}
    setTimeout(() => setCancellingAsk(false), 500)
  }

  const handleAsk = async () => {
    if (!manualQuestion.trim() && !pastedImage) return
    try {
      await api.ask(manualQuestion.trim(), pastedImage || undefined)
      setManualQuestion('')
      setPastedImage(null)
    } catch (e: any) { setError(e.message) }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isComposingRef.current) return
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk() }
  }

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setResumeUploading(true)
    setError(null)
    try {
      const res = await api.uploadResume(file)
      setResumeFile(file.name)
      useInterviewStore.getState().setConfig(await api.getConfig())
      if (res.parsed) {
        setToastMessage('简历已解析并选用')
      } else {
        setToastMessage(`已保存到历史，解析未成功：${res.parse_error || '请检查格式或稍后重试'}`)
      }
    } catch (err: any) { setError(err.message) }
    finally { setResumeUploading(false) }
    if (fileRef.current) fileRef.current.value = ''
  }
  const handleRemoveResume = async () => {
    await api.deleteResume(); setResumeFile(null)
    useInterviewStore.getState().setConfig(await api.getConfig())
  }

  return (
    <div className="ia-console-panel control-bar flex-shrink-0 space-y-2.5 rounded-[24px] px-3 py-3 md:px-4 md:py-3">
      {showColdStartHint && (
        <div className="flex items-center gap-2 rounded-2xl border border-accent-amber/20 bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>请先选择音频设备，再点击「开始」开始面试。</span>
        </div>
      )}
      {!wsConnected && (
        <div className="flex items-center gap-2 rounded-2xl border border-accent-amber/20 bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber">
          <span>连接已断开，</span>
          <button type="button" onClick={() => window.location.reload()} className="text-accent-blue hover:underline font-medium">
            点击重试
          </button>
        </div>
      )}
      {allModelsUnavailable && (
        <div className="flex items-center gap-2 rounded-2xl border border-accent-red/20 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>所有模型不可用，请检查 API 与网络。</span>
        </div>
      )}
      {!hasLoopback && platformInfo?.needs_virtual_device && (
        <div className="flex items-start gap-2 rounded-2xl border border-accent-amber/20 bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">未检测到系统音频设备。</span>
            <span className="text-text-muted"> 当前只有麦克风，无法录制面试官的声音。</span>
            <span className="text-accent-blue cursor-pointer" onClick={() => useInterviewStore.getState().toggleSettings()}> 查看配置说明</span>
          </div>
        </div>
      )}
      {selectedDevice !== null && !selectedIsLoopback && hasLoopback && (
        <div className="flex items-center gap-2 rounded-2xl border border-accent-amber/20 bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>你选择的是麦克风，建议选择带 ⟳ 标记的系统音频设备</span>
        </div>
      )}
      {lastWSError && (
        <div className="flex items-center gap-2 rounded-2xl border border-accent-red/20 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
          <span>{lastWSError}</span>
          <button onClick={() => setLastWSError(null)} className="ml-auto" aria-label="关闭"><X className="w-3 h-3" /></button>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-accent-red/20 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto" aria-label="关闭错误"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Image preview */}
      {pastedImage && (() => {
        const activeModel = config?.models?.[config.active_model]
        const supportsVision = activeModel?.supports_vision ?? false
        return (
          <div className="flex items-center gap-3 rounded-[22px] border border-accent-blue/15 bg-bg-tertiary/30 px-3 py-2.5">
            <img src={pastedImage} alt="screenshot" className="h-12 max-w-[200px] rounded-xl object-contain border border-bg-hover" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-text-primary">已粘贴截图</span>
              {!supportsVision && (
                <span className="text-[10px] text-accent-amber">当前模型不支持图片，将仅发送文字</span>
              )}
            </div>
            <button onClick={() => setPastedImage(null)} className="text-text-muted hover:text-accent-red ml-auto">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })()}

      {/* 移动端：录制中时显示状态指示条 */}
      {isRecording && (
        <div className={`flex md:hidden items-center justify-between rounded-2xl px-3 py-2 text-xs font-medium ${isPaused ? 'bg-accent-amber/15 text-accent-amber' : 'bg-accent-green/15 text-accent-green'}`}>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isPaused ? 'bg-accent-amber' : 'bg-accent-green animate-pulse'}`} />
            <span>{isPaused ? '已暂停' : '录制中'}</span>
          </div>
        </div>
      )}

      <div className="rounded-[22px] border border-accent-blue/15 bg-bg-tertiary/12 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.06)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Primary controls</p>
            <p className="text-xs text-text-secondary">采集设备与会话控制保持在最前面</p>
          </div>
          <div className="rounded-full border border-bg-hover/60 bg-bg-tertiary/25 px-3 py-1 text-[11px] font-medium text-text-secondary">
            {isRecording ? (isPaused ? '录制已暂停' : '录制进行中') : '待机状态'}
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="min-w-0 flex-1">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
              Capture device
            </label>
            <select
              value={selectedDevice ?? ''}
              onChange={async (e) => {
                const newId = Number(e.target.value)
                setSelectedDevice(newId)
                // 暂停中切换设备：只更新选中的设备，不自动恢复，让用户手动点"继续"
              }}
              className="w-full min-w-0 rounded-xl border border-bg-hover bg-bg-tertiary px-3 py-3 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
              disabled={isRecording && !isPaused}
              title={isRecording && !isPaused ? '录音中不可切换设备，请先暂停' : '选择音频输入设备'}
            >
              {devices.some((d) => d.is_loopback) && (
                <optgroup label="🔊 系统音频 (推荐)">
                  {devices.filter((d) => d.is_loopback).map((d) => (
                    <option key={d.id} value={d.id}>{d.name} ⟳</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="🎤 麦克风">
                {devices.filter((d) => !d.is_loopback).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {isRecording ? (
              <>
                {isPaused ? (
                  <button
                    onClick={handleResume}
                    disabled={loading}
                    className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-all duration-150 disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, rgb(var(--c-accent-green)), rgb(var(--c-accent-green) / 0.85))' }}
                  >
                    <PlayCircle className="w-3.5 h-3.5" />
                    <span>继续录制</span>
                  </button>
                ) : (
                  <button
                    onClick={handlePause}
                    disabled={loading}
                    className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold text-white transition-all duration-150 disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, rgb(var(--c-accent-amber)), rgb(var(--c-accent-amber) / 0.85))' }}
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>暂停录制</span>
                  </button>
                )}
                <button
                  onClick={handleStop}
                  disabled={loading}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold btn-danger disabled:opacity-50"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>结束面试</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleStart}
                disabled={loading || selectedDevice === null}
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-5 py-2.5 text-xs font-semibold btn-primary disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>开始面试</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-[22px] border border-bg-hover/50 bg-bg-tertiary/10 px-3 py-2.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Secondary</span>

        <div
          className={`hidden md:inline-flex items-stretch flex-shrink-0 rounded-xl border bg-bg-tertiary/50 overflow-visible ${
            resumeUploading || resumeFile || config?.has_resume
              ? 'border-bg-hover'
              : 'border-dashed border-bg-hover/90'
          }`}
        >
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.doc,.docx" onChange={handleResumeUpload} className="hidden" />
          {resumeUploading ? (
            <div className="flex items-center gap-1 pl-2 pr-1 py-2 text-xs text-text-muted rounded-l-xl">
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              <span className="hidden sm:inline">解析中…</span>
            </div>
          ) : resumeFile || config?.has_resume ? (
            <div className="flex items-center gap-1 pl-2 pr-1 py-2 text-xs rounded-l-xl min-w-0 max-w-[220px]">
              <FileText className="w-3.5 h-3.5 text-accent-green flex-shrink-0" />
              <span className="text-text-secondary truncate hidden sm:inline">{resumeFile || config?.resume_active_filename || '简历已上传'}</span>
              <button type="button" onClick={() => fileRef.current?.click()} className="text-accent-blue text-[10px] hover:underline hidden sm:inline flex-shrink-0">
                更换
              </button>
              <button type="button" onClick={handleRemoveResume} className="text-text-muted hover:text-accent-red flex-shrink-0"><X className="w-3 h-3" /></button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 pl-2 pr-1 py-2 text-text-secondary text-xs transition-colors rounded-l-xl hover:bg-bg-hover/60"
            >
              <Upload className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">简历</span>
            </button>
          )}
          <div className="my-1 w-px shrink-0 self-stretch bg-bg-hover/70" aria-hidden />
          <ResumeHistoryPopover />
        </div>

        {streamingIds.length > 0 && (
          <button onClick={handleCancelAsk} disabled={cancellingAsk}
            className="flex items-center gap-1 rounded-xl bg-accent-amber/15 px-3 py-2 text-xs text-accent-amber transition-colors hover:bg-accent-amber/25 disabled:opacity-50"
            title="取消全部正在生成的回答">
            {cancellingAsk ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">
              {cancellingAsk ? '取消中' : streamingIds.length > 1 ? `取消生成 (${streamingIds.length})` : '取消生成'}
            </span>
          </button>
        )}
        <button onClick={handleClear} disabled={clearing}
          className="flex items-center gap-1 rounded-xl bg-bg-tertiary px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50">
          {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{clearing ? '清空中' : '清空内容'}</span>
        </button>
      </div>

      {quickPrompts.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          <Zap className="w-3 h-3 text-accent-amber flex-shrink-0" />
          {quickPrompts.map((prompt) => (
            <button key={prompt}
              onClick={() => {
                setManualQuestion((prev) => prev ? `${prev} ${prompt}` : prompt)
                inputRef.current?.focus()
              }}
              className="prompt-pill px-2.5 py-1 text-[11px] rounded-lg font-medium whitespace-nowrap flex-shrink-0">
              {prompt}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-[22px] border border-accent-blue/15 bg-bg-tertiary/12 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.05)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Ask / follow-up</p>
            <p className="text-xs text-text-secondary">手动追问与截图审题保持主操作权重</p>
          </div>
          <div className="rounded-full border border-accent-blue/20 bg-accent-blue/10 px-3 py-1 text-[11px] font-medium text-accent-blue">
            Enter 发送
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input ref={inputRef} type="text" value={manualQuestion}
              onChange={(e) => setManualQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { isComposingRef.current = true }}
              onCompositionEnd={() => { setTimeout(() => { isComposingRef.current = false }, 0) }}
              onPaste={handlePaste}
              placeholder={pastedImage ? "可添加文字说明（可选），Enter 发送" : "输入问题，Enter 发送…"}
              className="w-full rounded-xl border border-bg-hover/50 bg-bg-tertiary/60 px-3.5 py-3 text-xs text-text-primary transition-all duration-200 placeholder:text-text-muted/60 pr-8 focus:border-accent-blue/50 focus:outline-none focus:ring-1 focus:ring-accent-blue/20" />
            {pastedImage && (
              <ImageIcon className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-accent-green" />
            )}
          </div>
          <button onClick={handleAsk} disabled={!manualQuestion.trim() && !pastedImage}
            className="flex min-h-[46px] items-center gap-1.5 rounded-xl px-4 py-3 text-xs font-semibold btn-primary disabled:opacity-20 flex-shrink-0"
            aria-label="发送问题">
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">发送追问</span>
          </button>
        </div>
      </div>
    </div>
  )
}
