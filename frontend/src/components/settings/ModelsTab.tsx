import { useState, useEffect, useCallback } from 'react'
import {
  Save,
  Plus,
  GripVertical,
  RefreshCw,
  ArrowUpToLine,
  ArrowDownToLine,
  Eye,
  Cpu,
  Trash2,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Check,
  Zap,
  Loader2,
  Sparkles,
  BrainCircuit,
} from 'lucide-react'
import { useInterviewStore, type ModelFullInfo } from '@/stores/configStore'
import { api } from '@/lib/api'
import { updateConfigAndRefresh } from '@/lib/configSync'
import { Field, GradientCard, StatusBadge } from './shared'

const EMPTY_MODEL: ModelFullInfo = {
  name: '',
  api_base_url: 'https://api.openai.com/v1',
  api_key: '',
  model: '',
  supports_think: false,
  supports_vision: false,
  enabled: true,
  has_key: false,
}

interface ModelRow {
  id: string
  originalIndex: number
  model: ModelFullInfo
}

function toModelRow(model: ModelFullInfo, index: number): ModelRow {
  return {
    id: `${index}:${model.name}:${model.model}:${model.api_base_url}`,
    originalIndex: index,
    model,
  }
}

export default function ModelsTab() {
  const config = useInterviewStore((s) => s.config)
  const modelHealth = useInterviewStore((s) => s.modelHealth)

  const [modelRows, setModelRows] = useState<ModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const [keyEdited, setKeyEdited] = useState<Record<number, boolean>>({})
  const [testingIdx, setTestingIdx] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, 'ok' | 'error' | 'checking'>>({})
  const [maxP, setMaxP] = useState(2)
  const [laySaving, setLaySaving] = useState(false)
  const [healthChecking, setHealthChecking] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  const [llmForm, setLlmForm] = useState({
    temperature: 0.5,
    max_tokens: 4096,
    think_mode: false,
    think_effort: 'off',
  })
  const [llmSaving, setLlmSaving] = useState(false)

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

  const loadModels = useCallback(async () => {
    setLoading(true)
    try {
      const { models: full } = await api.getModelsFull()
      setModelRows(full.map(toModelRow))
      setKeyEdited({})
      setTestResults({})
      if (full.length === 0) setExpandedIdx(-1)
    } catch {
      useInterviewStore.getState().setToastMessage('加载模型列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  useEffect(() => {
    if (!config?.models?.length) return
    setMaxP(Math.min(8, Math.max(1, config.max_parallel_answers ?? 2)))
    setLlmForm({
      temperature: config.temperature,
      max_tokens: config.max_tokens,
      think_mode: config.think_mode ?? false,
      think_effort: config.think_effort ?? 'off',
    })
    void syncHealthFromServer()
  }, [config, syncHealthFromServer])

  const updateModel = (idx: number, patch: Partial<ModelFullInfo>) => {
    setModelRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, model: { ...row.model, ...patch } } : row)),
    )
  }

  const addModel = () => {
    setModelRows((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${prev.length}`,
        originalIndex: prev.length,
        model: { ...EMPTY_MODEL },
      },
    ])
    setExpandedIdx(modelRows.length)
  }

  const removeModel = (idx: number) => {
    if (modelRows.length <= 1) {
      useInterviewStore.getState().setToastMessage('至少保留一个模型')
      return
    }
    setModelRows((prev) => prev.filter((_, i) => i !== idx))
    setExpandedIdx(null)
    setKeyEdited((prev) => {
      const next: Record<number, boolean> = {}
      Object.entries(prev).forEach(([k, v]) => {
        const n = Number(k)
        if (n < idx) next[n] = v
        else if (n > idx) next[n - 1] = v
      })
      return next
    })
  }

  const buildModelPayload = () =>
    modelRows.map(({ model: m }) => ({
      name: m.name.trim(),
      api_base_url: m.api_base_url.trim() || 'https://api.openai.com/v1',
      api_key: m.api_key,
      model: m.model.trim() || 'gpt-4o-mini',
      supports_think: m.supports_think,
      supports_vision: m.supports_vision,
      enabled: m.enabled,
    }))

  const resolveActiveIndex = () => {
    const activeOriginalIndex = config?.active_model ?? 0
    const nextActiveIndex = modelRows.findIndex((row) => row.originalIndex === activeOriginalIndex)
    return nextActiveIndex >= 0 ? nextActiveIndex : 0
  }

  const handleSaveModels = async (includeLayout: boolean = false) => {
    const invalid = modelRows.find((row) => !row.model.name.trim())
    if (invalid) {
      useInterviewStore.getState().setToastMessage('模型名称不能为空')
      return false
    }
    setSaving(true)
    try {
      await updateConfigAndRefresh({
        models: buildModelPayload(),
        active_model: resolveActiveIndex(),
        ...(includeLayout ? { max_parallel_answers: maxP } : {}),
      })
      useInterviewStore.getState().setToastMessage(includeLayout ? '已保存排序与并行设置' : '模型配置已保存')
      await loadModels()
      return true
    } catch (e: any) {
      useInterviewStore.getState().setToastMessage(e.message ?? '保存失败')
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleTestModel = async (idx: number) => {
    setTestingIdx(idx)
    setTestResults((prev) => ({ ...prev, [idx]: 'checking' }))
    try {
      const saved = await handleSaveModels()
      if (!saved) {
        setTestResults((prev) => ({ ...prev, [idx]: 'error' }))
        return
      }
      await api.checkSingleModelHealth(idx)
      const deadline = Date.now() + 20000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000))
        const { health } = await api.getModelsHealth()
        const st = health[String(idx)]
        if (st === 'ok' || st === 'error') {
          setTestResults((prev) => ({ ...prev, [idx]: st as 'ok' | 'error' }))
          useInterviewStore.getState().setModelHealth(idx, st as 'ok' | 'error')
          break
        }
      }
    } catch {
      setTestResults((prev) => ({ ...prev, [idx]: 'error' }))
    } finally {
      setTestingIdx(null)
    }
  }

  const runHealthCheck = async () => {
    setHealthChecking(true)
    try {
      const saved = await handleSaveModels()
      if (!saved) return
      const n = useInterviewStore.getState().config?.models?.length ?? 0
      for (let i = 0; i < n; i++) useInterviewStore.getState().setModelHealth(i, 'checking')
      await api.checkModelsHealth()
      const deadline = Date.now() + 25000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000))
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
    if (!modelRows.length) return
    setLaySaving(true)
    try {
      const saved = await handleSaveModels(true)
      if (saved) await syncHealthFromServer()
    } finally {
      setLaySaving(false)
    }
  }

  const moveToTop = (idx: number) => {
    if (idx <= 0) return
    setModelRows((rows) => {
      const next = [...rows]
      const [item] = next.splice(idx, 1)
      next.unshift(item)
      return next
    })
  }

  const moveToBottom = (idx: number) => {
    setModelRows((rows) => {
      if (idx >= rows.length - 1) return rows
      const next = [...rows]
      const [item] = next.splice(idx, 1)
      next.push(item)
      return next
    })
  }

  const onDragStart = (e: React.DragEvent, listIndex: number) => {
    setDragFrom(listIndex)
    e.dataTransfer.setData('text/plain', String(listIndex))
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
  const onDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10)
    setDragFrom(null)
    if (Number.isNaN(from) || from === dropIndex) return
    setModelRows((rows) => {
      const next = [...rows]
      const [item] = next.splice(from, 1)
      next.splice(dropIndex, 0, item)
      return next
    })
  }

  const handleSaveLlm = async () => {
    setLlmSaving(true)
    try {
      await updateConfigAndRefresh(llmForm)
      useInterviewStore.getState().setToastMessage('LLM 参数已保存')
    } catch (e: any) {
      useInterviewStore.getState().setToastMessage(e.message ?? '保存失败')
    } finally {
      setLlmSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-text-muted text-sm">加载中…</div>
  }

  const nModels = modelRows.length
  const parallelOptions = Array.from({ length: Math.min(8, Math.max(nModels, 1)) }, (_, i) => i + 1)

  return (
    <div className="p-5 space-y-5 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            <BrainCircuit className="w-4 h-4 text-accent-blue" />
            LLM 模型管理
          </h3>
          <p className="text-[11px] text-text-muted mt-0.5">添加、编辑或删除模型，配置后同步到后端。</p>
        </div>
        <button type="button" onClick={addModel}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-green/15 hover:bg-accent-green/25 border border-accent-green/30 text-accent-green text-xs font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" />
          添加
        </button>
      </div>

      {modelRows.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-accent-amber/40 bg-accent-amber/5 p-6 text-center space-y-3">
          <Cpu className="w-8 h-8 text-accent-amber mx-auto" />
          <p className="text-sm text-text-primary font-medium">尚未配置任何模型</p>
          <p className="text-xs text-text-muted">点击上方「添加」按钮配置你的第一个 LLM 模型</p>
        </div>
      )}

      <div className="space-y-2">
        {modelRows.map(({ model: m }, idx) => {
          const isExpanded = expandedIdx === idx
          const keyHasValue = m.has_key && !keyEdited[idx]
          const keyNewlyFilled = keyEdited[idx] && m.api_key.trim().length > 0
          const keyStatus = keyHasValue ? 'ok' : keyNewlyFilled ? 'ok' : 'error'
          const keyLabel = keyHasValue ? '已配置' : keyNewlyFilled ? '已填写' : '未配置'
          const tr = testResults[idx]

          return (
            <GradientCard key={m.name + idx} className={`transition-all duration-200 ${isExpanded ? 'ring-1 ring-accent-blue/30' : ''}`}>
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              >
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-300 text-sm font-bold flex-shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-text-primary text-sm">{m.name || '(未命名)'}</span>
                    {m.supports_vision && (
                      <span className="text-[10px] text-sky-400/90 px-1.5 py-0.5 rounded-md bg-sky-500/10 flex-shrink-0">
                        <Eye className="w-3 h-3 inline mr-0.5" />识图
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-text-muted truncate">{m.model || '(未设置)'}</span>
                    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      keyStatus === 'ok' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                    }`}>
                      <KeyRound className="w-2.5 h-2.5" />
                      {keyLabel}
                    </span>
                  </div>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-text-muted flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />}
              </button>

              <div className={`grid transition-all duration-200 ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden">
                  <div className="px-4 pb-4 space-y-3 border-t border-bg-hover/50 pt-3">
                    <div className="space-y-1">
                      <label className="text-xs text-text-secondary">模型名称 *</label>
                      <input type="text" value={m.name} onChange={(e) => updateModel(idx, { name: e.target.value })}
                        placeholder="如：GPT-4o、DeepSeek-V3" className="input-field" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-text-secondary">API Base URL</label>
                      <input type="text" value={m.api_base_url} onChange={(e) => updateModel(idx, { api_base_url: e.target.value })}
                        placeholder="https://api.openai.com/v1" className="input-field" />
                      <p className="text-[10px] text-text-muted">OpenAI 兼容接口地址</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-text-secondary">API Key</label>
                      <input
                        type="password"
                        value={keyEdited[idx] ? m.api_key : ''}
                        onChange={(e) => {
                          setKeyEdited((prev) => ({ ...prev, [idx]: true }))
                          updateModel(idx, { api_key: e.target.value })
                        }}
                        placeholder={m.has_key ? '已配置（输入新值覆盖）' : '填入你的 API Key'}
                        className="input-field"
                      />
                      {m.has_key && !keyEdited[idx] && (
                        <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          已有密钥，留空则保留原值
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-text-secondary">Model ID</label>
                      <input type="text" value={m.model} onChange={(e) => updateModel(idx, { model: e.target.value })}
                        placeholder="如：gpt-4o、ep-xxxxx" className="input-field" />
                      <p className="text-[10px] text-text-muted">API 请求中使用的模型标识</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={m.supports_think}
                          onChange={(e) => updateModel(idx, { supports_think: e.target.checked })}
                          className="w-4 h-4 rounded bg-bg-tertiary border-bg-hover text-accent-blue focus:ring-accent-blue focus:ring-offset-0" />
                        <span className="text-xs text-text-secondary">支持 Think</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={m.supports_vision}
                          onChange={(e) => updateModel(idx, { supports_vision: e.target.checked })}
                          className="w-4 h-4 rounded bg-bg-tertiary border-bg-hover text-accent-blue focus:ring-accent-blue focus:ring-offset-0" />
                        <span className="text-xs text-text-secondary">支持识图</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={m.enabled}
                          onChange={(e) => updateModel(idx, { enabled: e.target.checked })}
                          className="w-4 h-4 rounded bg-bg-tertiary border-bg-hover text-accent-blue focus:ring-accent-blue focus:ring-offset-0" />
                        <span className="text-xs text-text-secondary">启用</span>
                      </label>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <button type="button" onClick={() => handleTestModel(idx)} disabled={testingIdx !== null}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue/15 hover:bg-accent-blue/25 border border-accent-blue/30 text-accent-blue text-xs font-medium transition-colors disabled:opacity-60">
                        {testingIdx === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                        {testingIdx === idx ? '测试中…' : '测试连接'}
                      </button>
                      {tr && <StatusBadge status={tr} label={tr === 'ok' ? '可用' : tr === 'checking' ? '检测中…' : '不可用'} />}
                      <button type="button" onClick={() => removeModel(idx)} disabled={modelRows.length <= 1}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-accent-red hover:bg-accent-red/10 transition-colors disabled:opacity-30 disabled:pointer-events-none">
                        <Trash2 className="w-3.5 h-3.5" />
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </GradientCard>
          )
        })}
      </div>

      {modelRows.length > 0 && (
        <button type="button" onClick={() => void handleSaveModels()} disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50">
          <Save className="w-4 h-4" />
          {saving ? '保存中…' : '保存模型列表'}
        </button>
      )}

      {modelRows.length > 0 && (
        <GradientCard className="overflow-hidden">
          <div className="px-4 py-3 border-b border-bg-hover/60 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">多模型排序与并行</h3>
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                顶部「优先」模型最先分配题目；拖拽调整顺序，仅启用的模型参与作答。
              </p>
            </div>
            <button type="button" onClick={runHealthCheck} disabled={healthChecking}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-blue/15 hover:bg-accent-blue/25 border border-accent-blue/30 text-accent-blue text-xs font-medium transition-colors disabled:opacity-60"
              title="向各模型 API 发探测请求">
              <RefreshCw className={`w-3.5 h-3.5 ${healthChecking ? 'animate-spin' : ''}`} />
              {healthChecking ? '检测中…' : '全部检测'}
            </button>
          </div>

          <div className="p-3 space-y-2">
            {modelRows.map((row, j) => {
              const m = row.model
              const st = modelHealth[row.originalIndex]
              const err = st === 'error'
              const ok = st === 'ok'
              const on = m.enabled !== false
              return (
                <div key={row.id} onDragOver={onDragOver} onDrop={(e) => onDrop(e, j)}
                  className={`group flex items-stretch gap-2 rounded-xl border transition-all duration-150 ${
                    dragFrom === j ? 'border-accent-blue/50 bg-accent-blue/5 scale-[1.02]' : 'border-bg-hover/70 bg-bg-primary/40 hover:border-bg-hover'
                  } ${!on ? 'opacity-55' : ''}`}>
                  <div draggable onDragStart={(e) => onDragStart(e, j)} onDragEnd={() => setDragFrom(null)}
                    className="flex items-center px-1.5 cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary touch-none" title="拖拽调序">
                    <GripVertical className="w-4 h-4" />
                  </div>
                  <div className="flex items-center justify-center w-8 flex-shrink-0 my-2 rounded-lg bg-indigo-500/20 text-indigo-300 text-sm font-bold tabular-nums">{j + 1}</div>
                  <div className="flex-1 min-w-0 py-2.5 pr-2 flex flex-col justify-center gap-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-medium text-text-primary text-sm">{m.name}</span>
                      {m.supports_vision && (
                        <span className="flex items-center gap-0.5 text-[10px] text-sky-400/90 flex-shrink-0 px-1.5 py-0.5 rounded-md bg-sky-500/10">
                          <Eye className="w-3 h-3" /> 识图
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" role="switch" aria-checked={on}
                        onClick={() => updateModel(j, { enabled: !on })}
                        className={`relative h-6 w-10 rounded-full transition-colors ${on ? 'bg-accent-green/80' : 'bg-bg-hover'}`}>
                        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
                      </button>
                      <span className="text-[10px] text-text-muted">{on ? '已启用' : '已关闭'}</span>
                      <StatusBadge
                        status={healthChecking && st === 'checking' ? 'checking' : err ? 'error' : ok ? 'ok' : 'idle'}
                        label={healthChecking && st === 'checking' ? '检测中…' : err ? '不可用' : ok ? '可用' : '未检测'}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col justify-center gap-0.5 py-2 pr-2 border-l border-bg-hover/50 pl-2">
                    <button type="button" onClick={() => moveToTop(j)} disabled={j === 0}
                      className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary disabled:opacity-25 disabled:pointer-events-none" title="置顶">
                      <ArrowUpToLine className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => moveToBottom(j)} disabled={j >= modelRows.length - 1}
                      className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary disabled:opacity-25 disabled:pointer-events-none" title="置底">
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
                  <button key={v} type="button" onClick={() => setMaxP(v)}
                    className={`min-w-[2.5rem] px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      maxP === v
                        ? 'bg-accent-blue text-white shadow-lg shadow-accent-blue/20'
                        : 'bg-bg-tertiary/80 text-text-secondary hover:bg-bg-hover border border-bg-hover'
                    }`}>
                    {v}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-text-muted mt-1.5">路数 ≤ 已启用且可用的模型数。</p>
            </div>
            <button type="button" onClick={saveLayout} disabled={laySaving}
              className="w-full py-2.5 text-sm font-medium rounded-xl bg-accent-blue hover:bg-accent-blue/90 text-white shadow-md disabled:opacity-50 transition-colors">
              {laySaving ? '保存中…' : '保存排序与并行'}
            </button>
          </div>
        </GradientCard>
      )}

      <GradientCard className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-accent-blue" />
          LLM 生成参数
        </h3>
        <label className="flex items-center justify-between gap-3 cursor-pointer rounded-xl border border-bg-hover bg-bg-tertiary/30 px-3 py-3">
          <div>
            <span className="text-xs font-medium text-text-primary">Think（全局）</span>
            <p className="text-[10px] text-text-muted mt-0.5 leading-snug">
              对所有模型同时生效，与顶栏开关同步。开启时向接口请求思考能力。
            </p>
          </div>
          <button type="button" role="switch" aria-checked={llmForm.think_mode}
            onClick={() => {
              const next = !llmForm.think_mode
              setLlmForm({ ...llmForm, think_mode: next, think_effort: next ? 'high' : 'off' })
            }}
            className={`relative h-7 w-11 rounded-full flex-shrink-0 transition-colors ${llmForm.think_mode ? 'bg-accent-green' : 'bg-bg-hover'}`}>
            <span className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${llmForm.think_mode ? 'translate-x-4' : ''}`} />
          </button>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Temperature" hint="推荐 0.4–0.6">
            <input type="number" step="0.1" min="0" max="2" value={llmForm.temperature}
              onChange={(e) => setLlmForm({ ...llmForm, temperature: parseFloat(e.target.value) })} className="input-field" />
          </Field>
          <Field label="Max Tokens" hint="建议 2048–4096">
            <input type="number" step="256" min="256" max="32768" value={llmForm.max_tokens}
              onChange={(e) => setLlmForm({ ...llmForm, max_tokens: parseInt(e.target.value) })} className="input-field" />
          </Field>
        </div>
        <button type="button" onClick={handleSaveLlm} disabled={llmSaving}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50">
          <Save className="w-4 h-4" />
          {llmSaving ? '保存中…' : '保存 LLM 参数'}
        </button>
      </GradientCard>
    </div>
  )
}
