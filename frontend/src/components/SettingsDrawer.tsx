import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X,
  Save,
  AlertTriangle,
  HelpCircle,
  Smartphone,
  Plus,
  RotateCcw,
  GripVertical,
  Keyboard,
  RefreshCw,
  ArrowUpToLine,
  ArrowDownToLine,
  Eye,
  LayoutGrid,
  AlignVerticalSpaceAround,
  SlidersHorizontal,
} from 'lucide-react'
import QRCode from 'qrcode'
import { useInterviewStore } from '@/stores/configStore'
import { api } from '@/lib/api'
import { DEFAULT_QUICK_PROMPTS, getQuickPrompts, saveQuickPrompts } from './ControlBar'

function NetworkQRCode() {
  const [qrSrc, setQrSrc] = useState<string | null>(null)
  const [networkUrl, setNetworkUrl] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/network-info')
      .then(r => r.json())
      .then(async (data) => {
        setNetworkUrl(data.url)
        const src = await QRCode.toDataURL(data.url, {
          width: 200,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        })
        setQrSrc(src)
      })
      .catch(() => {})
  }, [])

  if (!networkUrl) return null

  return (
    <div className="bg-bg-tertiary/50 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider">
        <Smartphone className="w-3.5 h-3.5" />
        手机扫码访问
      </div>
      <div className="flex flex-col items-center gap-2">
        {qrSrc && <img src={qrSrc} alt="QR Code" className="rounded-lg" width={160} height={160} />}
        <p className="text-[11px] text-accent-blue break-all text-center select-all">{networkUrl}</p>
        <p className="text-[10px] text-text-muted text-center">手机和电脑需在同一 WiFi 下，音频在电脑端采集</p>
      </div>
    </div>
  )
}

function ModelsParallelEditor() {
  const { config, modelHealth } = useInterviewStore()
  const [order, setOrder] = useState<number[]>([])
  const [enabledList, setEnabledList] = useState<boolean[]>([])
  const [maxP, setMaxP] = useState(2)
  const [laySaving, setLaySaving] = useState(false)
  const [healthChecking, setHealthChecking] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  const syncHealthFromServer = useCallback(async () => {
    try {
      const { health } = await api.getModelsHealth()
      const setH = useInterviewStore.getState().setModelHealth
      Object.entries(health ?? {}).forEach(([k, v]) => {
        if (v === 'ok' || v === 'error' || v === 'checking') setH(Number(k), v)
      })
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!config?.models?.length) return
    setOrder(config.models.map((_, i) => i))
    setEnabledList(config.models.map((m) => m.enabled !== false))
    setMaxP(Math.min(8, Math.max(1, config.max_parallel_answers ?? 2)))
    void syncHealthFromServer()
  }, [config, syncHealthFromServer])

  const runHealthCheck = async () => {
    setHealthChecking(true)
    const n = config?.models?.length ?? 0
    for (let i = 0; i < n; i++) useInterviewStore.getState().setModelHealth(i, 'checking')
    try {
      await api.checkModelsHealth()
      const deadline = Date.now() + 25000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 450))
        await syncHealthFromServer()
        const { health } = await api.getModelsHealth().catch(() => ({ health: {} as Record<string, string> }))
        const vals = Object.values(health ?? {})
        if (vals.length >= n && !vals.includes('checking')) break
      }
      useInterviewStore.getState().setToastMessage('模型连通性已更新')
    } catch (e: any) {
      useInterviewStore.getState().setToastMessage(e.message ?? '检测失败')
    } finally {
      setHealthChecking(false)
    }
  }

  const saveLayout = async () => {
    if (!config?.models?.length) return
    setLaySaving(true)
    try {
      await api.modelsLayout({
        order,
        enabled: order.map((i) => enabledList[i] ?? true),
        max_parallel_answers: maxP,
      })
      useInterviewStore.getState().setConfig(await api.getConfig())
      useInterviewStore.getState().setToastMessage('已保存排序与并行设置')
      await syncHealthFromServer()
    } catch (e: any) {
      useInterviewStore.getState().setToastMessage(e.message ?? '保存失败')
    } finally {
      setLaySaving(false)
    }
  }

  const moveToTop = (j: number) => {
    if (j <= 0) return
    setOrder((o) => {
      const x = o[j]
      return [x, ...o.filter((_, i) => i !== j)]
    })
  }
  const moveToBottom = (j: number) => {
    setOrder((o) => {
      if (j >= o.length - 1) return o
      const x = o[j]
      return [...o.filter((_, i) => i !== j), x]
    })
  }

  const onDragStart = (e: React.DragEvent, listIndex: number) => {
    setDragFrom(listIndex)
    e.dataTransfer.setData('text/plain', String(listIndex))
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const onDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10)
    setDragFrom(null)
    if (Number.isNaN(from) || from === dropIndex) return
    setOrder((o) => {
      const next = [...o]
      const [item] = next.splice(from, 1)
      next.splice(dropIndex, 0, item)
      return next
    })
  }

  if (!config?.models?.length) return null

  const nModels = config.models.length
  const parallelOptions = Array.from({ length: Math.min(8, Math.max(nModels, 1)) }, (_, i) => i + 1)

  return (
    <div className="rounded-xl border border-bg-hover/80 bg-gradient-to-b from-bg-tertiary/30 to-bg-secondary/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-bg-hover/60 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">多模型答题</h3>
          <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
            列表越靠上优先级越高；拖拽左侧手柄调整顺序。仅启用的模型会参与作答。
          </p>
        </div>
        <button
          type="button"
          onClick={runHealthCheck}
          disabled={healthChecking}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-blue/15 hover:bg-accent-blue/25 border border-accent-blue/30 text-accent-blue text-xs font-medium transition-colors disabled:opacity-60"
          title="向各模型 API 发探测请求"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${healthChecking ? 'animate-spin' : ''}`} />
          {healthChecking ? '检测中…' : '检测连通性'}
        </button>
      </div>

      <div className="p-3 space-y-2">
        {order.map((origIdx, j) => {
          const m = config.models![origIdx]
          const st = modelHealth[origIdx]
          const err = st === 'error'
          const ok = st === 'ok'
          const on = enabledList[origIdx] !== false
          return (
            <div
              key={`${origIdx}-${j}`}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, j)}
              className={`group flex items-stretch gap-2 rounded-xl border transition-colors ${
                dragFrom === j ? 'border-accent-blue/50 bg-accent-blue/5' : 'border-bg-hover/70 bg-bg-primary/40 hover:border-bg-hover'
              } ${!on ? 'opacity-55' : ''}`}
            >
              <div
                draggable
                onDragStart={(e) => onDragStart(e, j)}
                onDragEnd={() => setDragFrom(null)}
                className="flex items-center px-1.5 cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary touch-none"
                title="按住拖动调整优先级"
              >
                <GripVertical className="w-4 h-4" />
              </div>
              <div className="flex items-center justify-center w-8 flex-shrink-0 my-2 rounded-lg bg-indigo-500/20 text-indigo-300 text-sm font-bold tabular-nums">
                {j + 1}
              </div>
              <div className="flex-1 min-w-0 py-2.5 pr-2 flex flex-col justify-center gap-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate font-medium text-text-primary text-sm">{m.name}</span>
                  {m.supports_vision && (
                    <span className="flex items-center gap-0.5 text-[10px] text-sky-400/90 flex-shrink-0 px-1.5 py-0.5 rounded-md bg-sky-500/10">
                      <Eye className="w-3 h-3" />
                      识图
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() =>
                      setEnabledList((prev) => {
                        const n = [...prev]
                        n[origIdx] = !n[origIdx]
                        return n
                      })
                    }
                    className={`relative h-6 w-10 rounded-full transition-colors ${on ? 'bg-accent-green/80' : 'bg-bg-hover'}`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`}
                    />
                  </button>
                  <span className="text-[10px] text-text-muted">{on ? '已启用' : '已关闭'}</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      err ? 'bg-accent-red/15 text-accent-red' : ok ? 'bg-accent-green/15 text-accent-green' : 'bg-bg-hover text-text-muted'
                    }`}
                  >
                    {healthChecking && st === 'checking' ? '检测中…' : err ? '不可用' : ok ? '可用' : '未检测'}
                  </span>
                </div>
              </div>
              <div className="flex flex-col justify-center gap-0.5 py-2 pr-2 border-l border-bg-hover/50 pl-2">
                <button
                  type="button"
                  onClick={() => moveToTop(j)}
                  disabled={j === 0}
                  className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary disabled:opacity-25 disabled:pointer-events-none"
                  title="置顶（最高优先级）"
                >
                  <ArrowUpToLine className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveToBottom(j)}
                  disabled={j >= order.length - 1}
                  className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary disabled:opacity-25 disabled:pointer-events-none"
                  title="置底（最低优先级）"
                >
                  <ArrowDownToLine className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="px-4 pb-3 space-y-3">
        <div>
          <p className="text-xs text-text-secondary mb-2">同时最多几路生成答案</p>
          <div className="flex flex-wrap gap-2">
            {parallelOptions.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setMaxP(v)}
                className={`min-w-[2.5rem] px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  maxP === v
                    ? 'bg-accent-blue text-white shadow-lg shadow-accent-blue/20'
                    : 'bg-bg-tertiary/80 text-text-secondary hover:bg-bg-hover border border-bg-hover'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-text-muted mt-1.5">路数 ≤ 已启用且可用的模型数；多题排队时按上方顺序抢槽。</p>
        </div>
        <button
          type="button"
          onClick={saveLayout}
          disabled={laySaving}
          className="w-full py-2.5 text-sm font-medium rounded-xl bg-accent-blue hover:bg-accent-blue/90 text-white shadow-md disabled:opacity-50 transition-colors"
        >
          {laySaving ? '保存中…' : '保存排序与并行'}
        </button>
      </div>
    </div>
  )
}

export default function SettingsDrawer() {
  const {
    settingsOpen,
    toggleSettings,
    config,
    options,
    platformInfo,
    sttLoaded,
    sttLoading,
    settingsDrawerTab,
    setSettingsDrawerTab,
    answerPanelLayout,
    setAnswerPanelLayout,
  } = useInterviewStore()

  const [form, setForm] = useState({
    temperature: 0.5,
    max_tokens: 4096,
    stt_provider: 'whisper' as string,
    whisper_model: 'base',
    doubao_stt_app_id: '',
    doubao_stt_access_token: '',
    doubao_stt_resource_id: 'volc.seedasr.sauc.duration',
    doubao_stt_boosting_table_id: '',
    silence_threshold: 0.01,
    silence_duration: 1.2,
    auto_detect: true,
    think_mode: false,
  })
  const [saving, setSaving] = useState(false)
  const [scrollBottomPx, setScrollBottomPx] = useState(40)

  useEffect(() => {
    if (config?.answer_autoscroll_bottom_px != null) {
      setScrollBottomPx(config.answer_autoscroll_bottom_px)
    }
  }, [config?.answer_autoscroll_bottom_px])

  useEffect(() => {
    if (config) {
      setForm({
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        stt_provider: config.stt_provider ?? 'whisper',
        whisper_model: config.whisper_model,
        doubao_stt_app_id: config.doubao_stt_app_id ?? '',
        doubao_stt_access_token: config.doubao_stt_access_token ?? '',
        doubao_stt_resource_id: config.doubao_stt_resource_id ?? 'volc.seedasr.sauc.duration',
        doubao_stt_boosting_table_id: config.doubao_stt_boosting_table_id ?? '',
        silence_threshold: config.silence_threshold,
        silence_duration: config.silence_duration,
        auto_detect: config.auto_detect,
        think_mode: config.think_mode ?? false,
      })
    }
  }, [config])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.updateConfig(form)
      useInterviewStore.getState().setConfig(await api.getConfig())
      useInterviewStore.getState().setToastMessage('配置已保存')
    } catch (e: any) {
      useInterviewStore.getState().setToastMessage(e.message ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const drawerRef = useRef<HTMLDivElement>(null)
  const previousActiveRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!settingsOpen || !drawerRef.current) return
    previousActiveRef.current = document.activeElement as HTMLElement | null
    const focusable = drawerRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')
    const first = focusable[0]
    if (first) first.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleSettings()
        previousActiveRef.current?.focus()
        return
      }
      if (e.key !== 'Tab' || !drawerRef.current) return
      const focusableNodes = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea'))
      const len = focusableNodes.length
      if (len === 0) return
      const idx = focusableNodes.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey) {
        if (idx <= 0) {
          e.preventDefault()
          focusableNodes[len - 1].focus()
        }
      } else {
        if (idx === -1 || idx >= len - 1) {
          e.preventDefault()
          focusableNodes[0].focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousActiveRef.current?.focus()
    }
  }, [settingsOpen, toggleSettings])

  if (!settingsOpen) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={toggleSettings} />
      <div ref={drawerRef} className="fixed right-0 top-0 bottom-0 w-full sm:w-[440px] bg-bg-secondary z-50 shadow-2xl flex flex-col border-l border-bg-tertiary">
        <div className="flex-shrink-0 border-b border-bg-tertiary px-3 pt-3 pb-0">
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-base font-semibold text-text-primary">偏好与配置</h2>
            <button type="button" onClick={toggleSettings} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary" aria-label="关闭">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex rounded-lg bg-bg-tertiary/80 p-1 gap-1">
            <button
              type="button"
              onClick={() => setSettingsDrawerTab('general')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-colors ${
                settingsDrawerTab === 'general' ? 'bg-bg-secondary text-accent-blue shadow-sm' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              设置
            </button>
            <button
              type="button"
              onClick={() => setSettingsDrawerTab('config')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-colors ${
                settingsDrawerTab === 'config' ? 'bg-bg-secondary text-accent-blue shadow-sm' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              配置
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* —— 设置：常用、展示 —— */}
          <div className={`p-5 space-y-5 ${settingsDrawerTab !== 'general' ? 'hidden' : ''}`}>
            {platformInfo?.needs_virtual_device && (
              <div className="bg-accent-amber/10 border border-accent-amber/30 rounded-lg p-3 text-xs space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-accent-amber flex-shrink-0 mt-0.5" />
                  <div className="text-text-secondary whitespace-pre-line">{platformInfo.instructions}</div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs px-1">
              <div className={`w-2 h-2 rounded-full ${sttLoaded ? 'bg-accent-green' : sttLoading ? 'bg-accent-amber animate-pulse' : 'bg-accent-red'}`} />
              <span className="text-text-secondary">
                语音识别: {sttLoaded ? '就绪' : sttLoading ? '加载中…' : '未就绪'}（{config?.stt_provider === 'doubao' ? '豆包' : 'Whisper'}）
              </span>
            </div>

            <Section title="答案展示方式">
              <p className="text-[11px] text-text-muted -mt-1">多路模型同时生成时，流式模式下各路答案自上而下依次排开，整页滚动阅读。</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAnswerPanelLayout('cards')}
                  className={`flex flex-col items-start gap-2 p-3 rounded-xl border text-left transition-all ${
                    answerPanelLayout === 'cards'
                      ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/30'
                      : 'border-bg-hover bg-bg-tertiary/30 hover:border-bg-hover'
                  }`}
                >
                  <LayoutGrid className={`w-5 h-5 ${answerPanelLayout === 'cards' ? 'text-accent-blue' : 'text-text-muted'}`} />
                  <span className="text-sm font-medium text-text-primary">卡片</span>
                  <span className="text-[10px] text-text-muted leading-snug">每题答案独立框，框内滚动</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAnswerPanelLayout('stream')}
                  className={`flex flex-col items-start gap-2 p-3 rounded-xl border text-left transition-all ${
                    answerPanelLayout === 'stream'
                      ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/30'
                      : 'border-bg-hover bg-bg-tertiary/30 hover:border-bg-hover'
                  }`}
                >
                  <AlignVerticalSpaceAround className={`w-5 h-5 ${answerPanelLayout === 'stream' ? 'text-accent-blue' : 'text-text-muted'}`} />
                  <span className="text-sm font-medium text-text-primary">流式</span>
                  <span className="text-[10px] text-text-muted leading-snug">自上而下通读，无单框高度限制</span>
                </button>
              </div>
              <div className="mt-3 space-y-1.5">
                <label className="text-xs text-text-secondary">流式跟滚阈值（像素）</label>
                <p className="text-[10px] text-text-muted leading-snug">
                  输出流式答案时，若当前已接近底部则自动滚到底；数值越小越容易停在中段方便上滑回看（4～400，可设很小如 8）。
                </p>
                <input
                  type="number"
                  min={4}
                  max={400}
                  value={scrollBottomPx}
                  onChange={(e) => setScrollBottomPx(Number(e.target.value) || 40)}
                  onBlur={async () => {
                    const v = Math.max(4, Math.min(400, scrollBottomPx || 40))
                    setScrollBottomPx(v)
                    try {
                      await api.updateConfig({ answer_autoscroll_bottom_px: v })
                      useInterviewStore.getState().setConfig(await api.getConfig())
                      useInterviewStore.getState().setToastMessage('跟滚阈值已保存')
                    } catch (e: unknown) {
                      useInterviewStore.getState().setToastMessage(e instanceof Error ? e.message : '保存失败')
                    }
                  }}
                  className="w-full max-w-[120px] bg-bg-tertiary border border-bg-hover rounded-lg px-3 py-2 text-sm text-text-primary"
                />
              </div>
            </Section>

            <NetworkQRCode />

            <QuickPromptsEditor />

            <Section title="快捷键">
              <div className="flex items-start gap-2 text-xs text-text-secondary">
                <Keyboard className="w-4 h-4 flex-shrink-0 mt-0.5 text-text-muted" />
                <p>
                  Boss Key：<kbd className="px-1.5 py-0.5 rounded bg-bg-tertiary border border-bg-hover font-mono text-[11px]">Ctrl+B</kbd>（Mac：<kbd className="px-1.5 py-0.5 rounded bg-bg-tertiary border border-bg-hover font-mono text-[11px]">Cmd+B</kbd>）
                </p>
              </div>
            </Section>

            <button
              type="button"
              onClick={() => setSettingsDrawerTab('config')}
              className="w-full py-2.5 text-xs font-medium rounded-xl border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              打开「配置」→ 模型并行、VAD、LLM 参数等
            </button>
          </div>

          {/* —— 配置：后端相关 —— */}
          <div className={`p-5 space-y-5 pb-8 ${settingsDrawerTab !== 'config' ? 'hidden' : ''}`}>
            <Section title="语音识别引擎">
              <Field label="识别引擎" hint="Whisper 本地免费；豆包需在 backend/config.json 中配置密钥">
                <select value={form.stt_provider} onChange={(e) => setForm({ ...form, stt_provider: e.target.value })} className="input-field">
                  {(options?.stt_providers ?? ['whisper', 'doubao']).map((p) => (
                    <option key={p} value={p}>
                      {p === 'whisper' ? 'Whisper（本地）' : '豆包（API）'}
                    </option>
                  ))}
                </select>
              </Field>
              {form.stt_provider === 'whisper' && (
                <Field label="Whisper 模型" hint="模型越大越准确但越慢">
                  <select value={form.whisper_model} onChange={(e) => setForm({ ...form, whisper_model: e.target.value })} className="input-field">
                    {(options?.whisper_models ?? ['tiny', 'base', 'small', 'medium', 'large-v3']).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {form.stt_provider === 'doubao' && (
                <p className="text-[11px] text-text-muted">豆包密钥与 Resource ID 等在 backend/config.json 中配置。</p>
              )}
            </Section>

            <ModelsParallelEditor />

            {config && (
              <div className="bg-bg-tertiary/50 rounded-xl p-3 text-xs space-y-1 border border-bg-hover/50">
                <p className="text-text-muted">主答模型（下拉切换）</p>
                <p className="text-text-primary font-medium">{config.model_name}</p>
                {!config.api_key_set && <p className="text-accent-red">API Key 未配置，请编辑 backend/config.json</p>}
              </div>
            )}

            <Section title="LLM 参数">
              <label className="flex items-center justify-between gap-3 cursor-pointer rounded-xl border border-bg-hover bg-bg-tertiary/30 px-3 py-3 mb-3">
                <div>
                  <span className="text-xs font-medium text-text-primary">Think（全局）</span>
                  <p className="text-[10px] text-text-muted mt-0.5 leading-snug">
                    <b className="text-text-secondary">全局</b>：对所有模型、并行答题同时生效，与顶栏开关同步。开启时向接口请求思考能力；若 API 仍返回
                    reasoning，流式仍会推送便于排查。
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.think_mode}
                  onClick={() => setForm({ ...form, think_mode: !form.think_mode })}
                  className={`relative h-7 w-11 rounded-full flex-shrink-0 transition-colors ${form.think_mode ? 'bg-accent-green' : 'bg-bg-hover'}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${form.think_mode ? 'translate-x-4' : ''}`}
                  />
                </button>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Temperature" hint="推荐 0.4–0.6">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })}
                    className="input-field"
                  />
                </Field>
                <Field label="Max Tokens" hint="建议 2048–4096">
                  <input
                    type="number"
                    step="256"
                    min="256"
                    max="32768"
                    value={form.max_tokens}
                    onChange={(e) => setForm({ ...form, max_tokens: parseInt(e.target.value) })}
                    className="input-field"
                  />
                </Field>
              </div>
              <p className="text-[10px] text-text-muted">模型列表与 Key 在 config.json</p>
            </Section>

            <Section title="语音活动检测 (VAD)">
              <div className="bg-bg-tertiary/30 rounded-lg p-3 text-xs text-text-muted space-y-1.5 mb-2">
                <div className="flex items-start gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-accent-blue" />
                  <span>根据音量与静音时长判断一句是否说完。</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="静音阈值" hint="环境吵可调高">
                  <input
                    type="number"
                    step="0.005"
                    min="0.001"
                    max="0.1"
                    value={form.silence_threshold}
                    onChange={(e) => setForm({ ...form, silence_threshold: parseFloat(e.target.value) })}
                    className="input-field"
                  />
                </Field>
                <Field label="静音时长 (秒)" hint="说完判定">
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="10"
                    value={form.silence_duration}
                    onChange={(e) => setForm({ ...form, silence_duration: parseFloat(e.target.value) })}
                    className="input-field"
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={form.auto_detect}
                  onChange={(e) => setForm({ ...form, auto_detect: e.target.checked })}
                  className="w-4 h-4 rounded bg-bg-tertiary border-bg-hover text-accent-blue focus:ring-accent-blue focus:ring-offset-0"
                />
                <span className="text-xs text-text-secondary">自动检测问题并生成答案</span>
              </label>
            </Section>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? '保存中…' : '保存配置'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .input-field {
          width: 100%; background: #1a1a24; color: #e2e8f0; font-size: 0.75rem;
          border-radius: 0.5rem; padding: 0.5rem 0.75rem; border: 1px solid #24243a;
          outline: none; transition: border-color 0.15s;
        }
        .input-field:focus { border-color: #6366f1; }
      `}</style>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-text-secondary">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-text-muted leading-tight">{hint}</p>}
    </div>
  )
}

function QuickPromptsEditor() {
  const [prompts, setPrompts] = useState<string[]>(getQuickPrompts)
  const [newPrompt, setNewPrompt] = useState('')

  const persist = (next: string[]) => {
    setPrompts(next)
    saveQuickPrompts(next)
    window.dispatchEvent(new Event('quick-prompts-updated'))
  }

  const addPrompt = () => {
    const trimmed = newPrompt.trim()
    if (!trimmed || prompts.includes(trimmed)) return
    persist([...prompts, trimmed])
    setNewPrompt('')
  }

  const removePrompt = (idx: number) => {
    persist(prompts.filter((_, i) => i !== idx))
  }

  const movePrompt = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= prompts.length) return
    const next = [...prompts]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    persist(next)
  }

  const resetDefaults = () => persist([...DEFAULT_QUICK_PROMPTS])

  return (
    <Section title="快捷提示词">
      <p className="text-[10px] text-text-muted -mt-1">点击输入框上方的标签可快速填入提示词，在此自定义列表</p>

      <div className="flex flex-wrap gap-1.5">
        {prompts.map((p, i) => (
          <div key={`${p}-${i}`} className="group flex items-center gap-0.5 px-2 py-1 bg-bg-tertiary/60 rounded-full border border-bg-hover text-xs text-text-secondary">
            <button onClick={() => movePrompt(i, -1)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity" title="左移">
              <GripVertical className="w-2.5 h-2.5" />
            </button>
            <span className="select-none">{p}</span>
            <button onClick={() => removePrompt(i)}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-accent-red"
              title="删除">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <input type="text" value={newPrompt}
          onChange={(e) => setNewPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPrompt() } }}
          placeholder="输入新的快捷词..."
          className="input-field flex-1" />
        <button onClick={addPrompt} disabled={!newPrompt.trim()}
          className="px-2 py-2 bg-accent-green hover:bg-accent-green/90 text-white text-xs rounded-lg transition-colors disabled:opacity-30 flex-shrink-0"
          title="添加">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button onClick={resetDefaults}
          className="px-2 py-2 bg-bg-tertiary hover:bg-bg-hover text-text-secondary text-xs rounded-lg transition-colors flex-shrink-0"
          title="恢复默认">
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </Section>
  )
}
