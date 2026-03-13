import { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Square, Trash2, Upload, Send, FileText, X, AlertTriangle, Image as ImageIcon } from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { api } from '@/lib/api'

export default function ControlBar() {
  const { isRecording, devices, config, platformInfo, clearSession } = useInterviewStore()
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null)
  const [manualQuestion, setManualQuestion] = useState('')
  const [pastedImage, setPastedImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resumeFile, setResumeFile] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedIsLoopback = devices.find((d) => d.id === selectedDevice)?.is_loopback ?? false
  const hasLoopback = devices.some((d) => d.is_loopback)

  useEffect(() => {
    if (devices.length > 0 && selectedDevice === null) {
      const loopback = devices.find((d) => d.is_loopback)
      setSelectedDevice(loopback?.id ?? devices[0].id)
    }
  }, [devices])

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
    setLoading(true)
    try { await api.stop() } catch {} finally { setLoading(false) }
  }
  const handleClear = async () => { await api.clear(); clearSession() }

  const handleAsk = async () => {
    if (!manualQuestion.trim() && !pastedImage) return
    try {
      await api.ask(manualQuestion.trim(), pastedImage || undefined)
      setManualQuestion('')
      setPastedImage(null)
    } catch (e: any) { setError(e.message) }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk() }
  }

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await api.uploadResume(file); setResumeFile(file.name)
      useInterviewStore.getState().setConfig(await api.getConfig())
    } catch (err: any) { setError(err.message) }
    if (fileRef.current) fileRef.current.value = ''
  }
  const handleRemoveResume = async () => {
    await api.deleteResume(); setResumeFile(null)
    useInterviewStore.getState().setConfig(await api.getConfig())
  }

  return (
    <div className="border-t border-bg-tertiary bg-bg-secondary px-3 md:px-4 py-2.5 flex-shrink-0 space-y-1.5">
      {!hasLoopback && platformInfo?.needs_virtual_device && (
        <div className="flex items-start gap-2 text-xs text-accent-amber bg-accent-amber/10 px-3 py-2 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">未检测到系统音频设备。</span>
            <span className="text-text-muted"> 当前只有麦克风，无法录制面试官的声音。</span>
            <span className="text-accent-blue cursor-pointer" onClick={() => useInterviewStore.getState().toggleSettings()}> 查看配置说明</span>
          </div>
        </div>
      )}
      {selectedDevice !== null && !selectedIsLoopback && hasLoopback && (
        <div className="flex items-center gap-2 text-xs text-accent-amber bg-accent-amber/10 px-3 py-1.5 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>你选择的是麦克风，建议选择带 ⟳ 标记的系统音频设备</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-xs text-accent-red bg-accent-red/10 px-3 py-1.5 rounded-lg">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Image preview */}
      {pastedImage && (() => {
        const activeModel = config?.models?.[config.active_model]
        const supportsVision = activeModel?.supports_vision ?? false
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary/50 rounded-lg">
            <img src={pastedImage} alt="screenshot" className="h-12 max-w-[200px] rounded object-contain border border-bg-hover" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-text-muted">已粘贴截图</span>
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

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={selectedDevice ?? ''}
          onChange={(e) => setSelectedDevice(Number(e.target.value))}
          className="bg-bg-tertiary text-text-primary text-xs rounded-lg px-2 py-2 border border-bg-hover focus:outline-none focus:border-accent-blue max-w-[200px]"
          disabled={isRecording}
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

        {isRecording ? (
          <button onClick={handleStop} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-accent-red hover:bg-accent-red/90 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50">
            <Square className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">停止</span>
          </button>
        ) : (
          <button onClick={handleStart} disabled={loading || selectedDevice === null}
            className="flex items-center gap-1.5 px-3 py-2 bg-accent-blue hover:bg-accent-blue/90 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50">
            <Play className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">开始面试</span>
          </button>
        )}

        <input ref={fileRef} type="file" accept=".pdf,.txt,.md" onChange={handleResumeUpload} className="hidden" />
        {resumeFile || config?.has_resume ? (
          <div className="flex items-center gap-1 px-2 py-2 bg-bg-tertiary rounded-lg text-xs">
            <FileText className="w-3.5 h-3.5 text-accent-green" />
            <span className="text-text-secondary max-w-[80px] truncate hidden sm:inline">{resumeFile || '简历'}</span>
            <button onClick={handleRemoveResume} className="text-text-muted hover:text-accent-red"><X className="w-3 h-3" /></button>
          </div>
        ) : (
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 px-2 py-2 bg-bg-tertiary hover:bg-bg-hover text-text-secondary text-xs rounded-lg transition-colors border border-dashed border-bg-hover">
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">简历</span>
          </button>
        )}

        <button onClick={handleClear}
          className="flex items-center gap-1 px-2 py-2 bg-bg-tertiary hover:bg-bg-hover text-text-secondary text-xs rounded-lg transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <div className="flex-1" />

        {/* Manual input with paste support */}
        <div className="flex items-center gap-1.5 flex-1 max-w-lg min-w-[150px]">
          <div className="relative flex-1">
            <input ref={inputRef} type="text" value={manualQuestion}
              onChange={(e) => setManualQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={pastedImage ? "可添加文字说明（可选）..." : "输入问题 / Ctrl+V 粘贴截图..."}
              className="w-full bg-bg-tertiary text-text-primary text-xs rounded-lg px-3 py-2 border border-bg-hover focus:outline-none focus:border-accent-blue placeholder:text-text-muted pr-8" />
            {pastedImage && (
              <ImageIcon className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-accent-green" />
            )}
          </div>
          <button onClick={handleAsk} disabled={!manualQuestion.trim() && !pastedImage}
            className="px-2.5 py-2 bg-accent-blue hover:bg-accent-blue/90 text-white text-xs rounded-lg transition-colors disabled:opacity-30">
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
