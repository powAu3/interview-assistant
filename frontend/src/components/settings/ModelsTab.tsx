import { useState, useEffect, useCallback } from 'react'
import {
  Save,
  Plus,
  GripVertical,
  RefreshCw,
  ArrowUpToLine,
  ArrowDownToLine,
  Eye,
  Trash2,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Zap,
  Loader2,
  Sparkles,
  BrainCircuit,
  SlidersHorizontal,
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
  const modelHealthDetail = useInterviewStore((s) => s.modelHealthDetail)
  const modelHealthLatency = useInterviewStore((s) => s.modelHealthLatency)

  const [modelRows, setModelRows] = useState<ModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const [testingIdx, setTestingIdx] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, 'ok' | 'error' | 'checking'>>({})
  const [maxP, setMaxP] = useState(2)
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
      const { health, detail, latency } = await api.getModelsHealth()
      const setH = useInterviewStore.getState().setModelHealth
      Object.entries(health ?? {}).forEach(([k, v]) => {
        if (v === 'ok' || v === 'error' || v === 'checking') {
          const index = Number(k)
          setH(index, v, detail?.[k], latency?.[k])
        }
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
      setTestResults({})
      if (full.length === 0) setExpandedIdx(0)
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

  const handleSaveModels = async () => {
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
        max_parallel_answers: maxP,
      })
      useInterviewStore.getState().setToastMessage('模型队列已保存')
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
    if (modelRows[idx]?.model.enabled === false) {
      useInterviewStore.getState().setToastMessage('请先启用该模型，再测试连接')
      return
    }
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
        const { health, detail, latency } = await api.getModelsHealth()
        const st = health[String(idx)]
        if (st === 'ok' || st === 'error') {
          setTestResults((prev) => ({ ...prev, [idx]: st as 'ok' | 'error' }))
          useInterviewStore.getState().setModelHealth(idx, st as 'ok' | 'error', detail?.[String(idx)], latency?.[String(idx)])
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
      const models = useInterviewStore.getState().config?.models ?? []
      const enabledIndexes = models
        .map((model, index) => ({ model, index }))
        .filter(({ model }) => model.enabled !== false)
        .map(({ index }) => index)
      if (enabledIndexes.length === 0) {
        useInterviewStore.getState().setToastMessage('没有已启用的模型可检测')
        return
      }
      enabledIndexes.forEach((index) => useInterviewStore.getState().setModelHealth(index, 'checking'))
      await api.checkModelsHealth()
      const deadline = Date.now() + 25000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000))
        await syncHealthFromServer()
        const { health } = await api.getModelsHealth().catch(() => ({ health: {} as Record<string, string> }))
        const done = enabledIndexes.every((index) => {
          const value = health?.[String(index)]
          return value === 'ok' || value === 'error'
        })
        if (done) break
      }
      useInterviewStore.getState().setToastMessage('模型连通性已更新')
    } catch (e: any) {
      useInterviewStore.getState().setToastMessage(e.message ?? '检测失败')
    } finally {
      setHealthChecking(false)
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
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
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

  const enabledCount = modelRows.filter((row) => row.model.enabled !== false).length
  const parallelMax = Math.max(1, Math.min(8, Math.max(enabledCount, modelRows.length)))
  const parallelOptions = Array.from({ length: parallelMax }, (_, i) => i + 1)

  return (
    <div className="p-5 space-y-5 pb-8">
      <GradientCard className="overflow-hidden">
        <div className="px-4 py-3 border-b border-bg-hover/60 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                <BrainCircuit className="w-4 h-4 text-accent-blue" />
                模型队列
              </h3>
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                从上到下就是答题优先级；启用、连通性、模型参数都在同一个列表里管理。
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={runHealthCheck}
                disabled={healthChecking || enabledCount === 0}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-blue/15 hover:bg-accent-blue/25 border border-accent-blue/30 text-accent-blue text-xs font-medium transition-colors disabled:opacity-50"
                title={enabledCount === 0 ? '请先启用至少一个模型' : '只向已启用模型 API 发探测请求'}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${healthChecking ? 'animate-spin' : ''}`} />
                检测
              </button>
              <button
                type="button"
                onClick={addModel}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-green/15 hover:bg-accent-green/25 border border-accent-green/30 text-accent-green text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                添加
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-bg-hover/60 bg-bg-primary/35 px-3 py-3">
            <div className="flex items-center gap-2 mb-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-xs font-medium text-text-primary">并行生成路数</span>
              <span className="text-[10px] text-text-muted ml-auto">已启用 {enabledCount} / {modelRows.length}</span>
            </div>
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
          </div>
        </div>

        {modelRows.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <BrainCircuit className="w-8 h-8 text-text-muted mx-auto" />
            <p className="text-sm text-text-primary font-medium">尚未配置任何模型</p>
            <p className="text-xs text-text-muted">添加一个 OpenAI 兼容模型后即可开始答题。</p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {modelRows.map((row, idx) => {
              const m = row.model
              const isExpanded = expandedIdx === idx
              const keyHasValue = m.api_key.trim().length > 0 || m.has_key
              const tr = testResults[idx]
              const healthDetail = modelHealthDetail[row.originalIndex]?.trim()
              const on = m.enabled !== false
              const st = on ? (tr ?? modelHealth[row.originalIndex]) : undefined
              const keyLabel = keyHasValue ? '已填写' : '未配置'
              const healthTitle = healthDetail ? `模型连接详情：${healthDetail}` : undefined

              return (
                <div
                  key={row.id}
                  onDragOver={onDragOver}
                  onDrop={(e) => onDrop(e, idx)}
                  className={`rounded-xl border transition-all duration-150 ${
                    dragFrom === idx
                      ? 'border-accent-blue/50 bg-accent-blue/5 scale-[1.01]'
                      : isExpanded
                        ? 'border-accent-blue/35 bg-bg-primary/45'
                        : 'border-bg-hover/70 bg-bg-primary/35 hover:border-bg-hover'
                  } ${!on ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-stretch gap-2">
                    <div
                      draggable
                      onDragStart={(e) => onDragStart(e, idx)}
                      onDragEnd={() => setDragFrom(null)}
                      className="flex items-center px-1.5 cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary touch-none"
                      title="拖拽调序"
                    >
                      <GripVertical className="w-4 h-4" />
                    </div>

                    <div className="flex items-center justify-center w-8 flex-shrink-0 my-2 rounded-lg bg-indigo-500/20 text-indigo-300 text-sm font-bold tabular-nums">
                      {idx + 1}
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                      className="min-w-0 flex-1 py-2.5 text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate font-medium text-text-primary text-sm">{m.name || '(未命名)'}</span>
                        {m.supports_vision && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-sky-400/90 flex-shrink-0 px-1.5 py-0.5 rounded-md bg-sky-500/10">
                            <Eye className="w-3 h-3" /> 识图
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="text-[10px] text-text-muted truncate max-w-[180px]">{m.model || '(未设置)'}</span>
                        <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          keyHasValue ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                        }`}>
                          <KeyRound className="w-2.5 h-2.5" />
                          {keyLabel}
                        </span>
                        <StatusBadge
                          status={st === 'ok' ? 'ok' : st === 'error' ? 'error' : st === 'checking' ? 'checking' : 'idle'}
                          label={!on ? '已停用' : st === 'ok' ? (modelHealthLatency[row.originalIndex] ? `可用 · ${modelHealthLatency[row.originalIndex]}ms` : '可用') : st === 'error' ? '不可用' : st === 'checking' ? '检测中…' : '未检测'}
                          title={on ? healthTitle : undefined}
                        />
                      </div>
                    </button>

                    <div className="flex items-center gap-1 py-2 pr-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        onClick={() => updateModel(idx, { enabled: !on })}
                        className={`relative h-6 w-10 rounded-full transition-colors ${on ? 'bg-accent-green/80' : 'bg-bg-hover'}`}
                        title={on ? '关闭此模型' : '启用此模型'}
                      >
                        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                        className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary"
                        aria-label={isExpanded ? '收起模型配置' : '展开模型配置'}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className={`grid transition-all duration-200 ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="overflow-hidden">
                      <div className="px-4 pb-4 space-y-3 border-t border-bg-hover/50 pt-3">
                        <div className="grid sm:grid-cols-2 gap-3">
                          <Field label="模型名称 *">
                            <input
                              type="text"
                              value={m.name}
                              onChange={(e) => updateModel(idx, { name: e.target.value })}
                              placeholder="如：GPT-4o、DeepSeek-V3"
                              className="input-field"
                            />
                          </Field>
                          <Field label="Model ID" hint="API 请求中使用的模型标识">
                            <input
                              type="text"
                              value={m.model}
                              onChange={(e) => updateModel(idx, { model: e.target.value })}
                              placeholder="如：gpt-4o、ep-xxxxx"
                              className="input-field"
                            />
                          </Field>
                        </div>
                        <Field label="API Base URL" hint="OpenAI 兼容接口地址">
                          <input
                            type="text"
                            value={m.api_base_url}
                            onChange={(e) => updateModel(idx, { api_base_url: e.target.value })}
                            placeholder="https://api.openai.com/v1"
                            className="input-field"
                          />
                        </Field>
                        <Field label="API Key">
                          <input
                            type="text"
                            value={m.api_key}
                            onChange={(e) => updateModel(idx, { api_key: e.target.value })}
                            placeholder="填入你的 API Key"
                            className="input-field"
                          />
                        </Field>
                        <div className="flex flex-wrap items-center gap-4 pt-1">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={m.supports_think}
                              onChange={(e) => updateModel(idx, { supports_think: e.target.checked })}
                              className="w-4 h-4 rounded bg-bg-tertiary border-bg-hover text-accent-blue focus:ring-accent-blue focus:ring-offset-0"
                            />
                            <span className="text-xs text-text-secondary">支持 Think</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={m.supports_vision}
                              onChange={(e) => updateModel(idx, { supports_vision: e.target.checked })}
                              className="w-4 h-4 rounded bg-bg-tertiary border-bg-hover text-accent-blue focus:ring-accent-blue focus:ring-offset-0"
                            />
                            <span className="text-xs text-text-secondary">支持识图</span>
                          </label>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveToTop(idx)}
                              disabled={idx === 0}
                              className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary disabled:opacity-25 disabled:pointer-events-none"
                              title="置顶"
                            >
                              <ArrowUpToLine className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveToBottom(idx)}
                              disabled={idx >= modelRows.length - 1}
                              className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary disabled:opacity-25 disabled:pointer-events-none"
                              title="置底"
                            >
                              <ArrowDownToLine className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleTestModel(idx)}
                              disabled={testingIdx !== null || !on}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue/15 hover:bg-accent-blue/25 border border-accent-blue/30 text-accent-blue text-xs font-medium transition-colors disabled:opacity-60"
                              title={on ? '测试该模型连接' : '请先启用该模型'}
                            >
                              {testingIdx === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                              {testingIdx === idx ? '测试中…' : '测试连接'}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeModel(idx)}
                              disabled={modelRows.length <= 1}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-accent-red hover:bg-accent-red/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              删除
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {modelRows.length > 0 && (
          <div className="px-4 pb-4">
            <button
              type="button"
              onClick={() => void handleSaveModels()}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? '保存中…' : '保存模型队列'}
            </button>
          </div>
        )}
      </GradientCard>

      <GradientCard className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-accent-blue" />
          生成参数
        </h3>
        <label className="flex items-center justify-between gap-3 cursor-pointer rounded-xl border border-bg-hover bg-bg-tertiary/30 px-3 py-3">
          <div>
            <span className="text-xs font-medium text-text-primary">Think（全局）</span>
            <p className="text-[10px] text-text-muted mt-0.5 leading-snug">
              对所有模型同时生效，与顶栏会场开关同步。
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={llmForm.think_mode}
            onClick={() => {
              const next = !llmForm.think_mode
              setLlmForm({ ...llmForm, think_mode: next, think_effort: next ? 'high' : 'off' })
            }}
            className={`relative h-7 w-11 rounded-full flex-shrink-0 transition-colors ${llmForm.think_mode ? 'bg-accent-green' : 'bg-bg-hover'}`}
          >
            <span className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${llmForm.think_mode ? 'translate-x-4' : ''}`} />
          </button>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Temperature" hint="推荐 0.4-0.6">
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={llmForm.temperature}
              onChange={(e) => setLlmForm({ ...llmForm, temperature: parseFloat(e.target.value) })}
              className="input-field"
            />
          </Field>
          <Field label="Max Tokens" hint="建议 2048-4096">
            <input
              type="number"
              step="256"
              min="256"
              max="32768"
              value={llmForm.max_tokens}
              onChange={(e) => setLlmForm({ ...llmForm, max_tokens: parseInt(e.target.value) })}
              className="input-field"
            />
          </Field>
        </div>
        <button
          type="button"
          onClick={handleSaveLlm}
          disabled={llmSaving}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {llmSaving ? '保存中…' : '保存生成参数'}
        </button>
      </GradientCard>
    </div>
  )
}
