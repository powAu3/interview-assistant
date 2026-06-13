import { useState, useEffect, useCallback, useRef } from 'react'
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
  X,
} from 'lucide-react'
import { useInterviewStore, type ModelFullInfo } from '@/stores/configStore'
import { api } from '@/lib/api'
import { updateConfigAndRefresh } from '@/lib/configSync'
import {
  Field,
  GradientCard,
  SaveStateBadge,
  StatusBadge,
  useDirtySnapshot,
  useSettingsDirtyRegistration,
  type SaveState,
} from './shared'

const EMPTY_MODEL: ModelFullInfo = {
  name: '',
  api_base_url: 'https://api.openai.com/v1',
  api_key: '',
  model: '',
  supports_think: false,
  supports_vision: false,
  enabled: true,
  think_enabled_params: {},
  think_disabled_params: {},
  has_key: false,
}

interface ModelRow {
  id: string
  originalIndex: number
  model: ModelFullInfo
}

type ModelProbeResult = {
  ok: boolean
  detail?: string
  latency_ms?: number
  supports_vision: boolean
  supports_think: boolean
  think_style: string
  think_params: Record<string, unknown>
  think_disabled_params: Record<string, unknown>
  vision_detail?: string
  think_detail?: string
  think_disabled_detail?: string
}

type RemoteModelListState = {
  loading: boolean
  models: RemoteModel[]
  error: string | null
  loaded: boolean
  requestKey?: string
}

type RemoteModel = {
  id: string
  owned_by?: string | null
}

const EMPTY_REMOTE_MODEL_LIST: RemoteModelListState = {
  loading: false,
  models: [],
  error: null,
  loaded: false,
}

const KEEP_EXISTING_API_KEY = '__IA_KEEP_EXISTING_API_KEY__'

function toModelRow(model: ModelFullInfo, index: number): ModelRow {
  return {
    id: `${index}:${model.name}:${model.model}:${model.api_base_url}`,
    originalIndex: index,
    model,
  }
}

function buildModelPayloadFromRows(rows: ModelRow[]) {
  return rows.map(({ model: m, originalIndex }) => ({
    name: m.name.trim(),
    api_base_url: m.api_base_url.trim() || 'https://api.openai.com/v1',
    api_key: m.api_key.trim() ? m.api_key : m.has_key ? KEEP_EXISTING_API_KEY : '',
    model_original_index: originalIndex,
    model: m.model.trim() || 'gpt-4o-mini',
    supports_think: m.supports_think,
    supports_vision: m.supports_vision,
    enabled: m.enabled,
    think_enabled_params: m.think_enabled_params ?? {},
    think_disabled_params: m.think_disabled_params ?? {},
  }))
}

function resolveActiveIndexForRows(rows: ModelRow[], activeOriginalIndex = 0) {
  const nextActiveIndex = rows.findIndex((row) => row.originalIndex === activeOriginalIndex)
  return nextActiveIndex >= 0 ? nextActiveIndex : 0
}

function buildQueueSnapshot(rows: ModelRow[], maxParallel: number, activeOriginalIndex = 0) {
  return {
    models: buildModelPayloadFromRows(rows),
    active_model: resolveActiveIndexForRows(rows, activeOriginalIndex),
    max_parallel_answers: maxParallel,
  }
}

function groupRemoteModels(models: RemoteModel[]) {
  const groups = new Map<string, RemoteModel[]>()
  models.forEach((model) => {
    const owner = model.owned_by?.trim() || '其他'
    groups.set(owner, [...(groups.get(owner) ?? []), model])
  })
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
}

function remoteModelRequestKey(model: ModelFullInfo) {
  return `${(model.api_base_url || '').trim()}\n${model.api_key || ''}`
}

function apiKeyPayloadValue(model: ModelFullInfo) {
  return model.api_key.trim() ? model.api_key : model.has_key ? KEEP_EXISTING_API_KEY : ''
}

function apiKeyPlaceholder(model: ModelFullInfo) {
  if (model.has_key && !model.api_key.trim()) return '已保存，留空则保留现有 API Key'
  return '填入你的 API Key'
}

function formatRemoteModelError(error: unknown): string {
  const raw = error instanceof Error && error.message
    ? error.message
    : typeof error === 'string' && error.trim()
      ? error
      : '获取模型列表失败'
  const lower = raw.toLowerCase()
  if (lower.includes('request blocked') || lower.includes('blocked') || raw.includes('请求被阻止')) {
    return `请求被上游拦截：${raw}`
  }
  if (raw.includes('401') || raw.includes('403') || lower.includes('invalid token') || lower.includes('unauthorized')) {
    return `认证失败：请检查 API Key。${raw}`
  }
  if (raw.includes('HTTP 404') || raw.includes('HTTP 405') || lower.includes('all candidates failed') || raw.includes('未找到可用')) {
    return `模型列表接口不可用：当前 Base URL 推导出的 /models 地址不可用，可手动填写 Model ID。${raw}`
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return `获取模型列表超时：${raw}`
  }
  if (lower.includes('parse') || raw.includes('不是 JSON')) {
    return `模型列表响应格式不兼容：${raw}`
  }
  return raw
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
  const [probeResults, setProbeResults] = useState<Record<number, ModelProbeResult>>({})
  const [remoteModelLists, setRemoteModelLists] = useState<Record<string, RemoteModelListState>>({})
  const [maxP, setMaxP] = useState(2)
  const [healthChecking, setHealthChecking] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const nameInputRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const pendingFocusIdx = useRef<number | null>(null)
  const modelRowsRef = useRef<ModelRow[]>([])
  const remoteModelRequestVersions = useRef<Record<string, number>>({})

  const [llmForm, setLlmForm] = useState({
    temperature: 0.5,
    max_tokens: 4096,
    think_mode: false,
    think_effort: 'off',
  })
  const [llmSaving, setLlmSaving] = useState(false)
  const [queueSaveState, setQueueSaveState] = useState<SaveState>('idle')
  const [queueSaveError, setQueueSaveError] = useState<string | null>(null)
  const [llmSaveState, setLlmSaveState] = useState<SaveState>('idle')
  const [llmSaveError, setLlmSaveError] = useState<string | null>(null)
  const queueSnapshot = buildQueueSnapshot(modelRows, maxP, config?.active_model ?? 0)
  const {
    dirty: queueDirty,
    markSaved: markQueueSaved,
    resetBaseline: resetQueueBaseline,
  } = useDirtySnapshot(queueSnapshot)
  const {
    dirty: llmDirty,
    markSaved: markLlmSaved,
    resetBaseline: resetLlmBaseline,
  } = useDirtySnapshot(llmForm)
  useSettingsDirtyRegistration('models', queueDirty || llmDirty)

  useEffect(() => {
    modelRowsRef.current = modelRows
  }, [modelRows])

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
      const rows = full.map(toModelRow)
      const currentConfig = useInterviewStore.getState().config
      const nextMaxP = Math.min(8, Math.max(1, currentConfig?.max_parallel_answers ?? 2))
      setModelRows(rows)
      setMaxP(nextMaxP)
      resetQueueBaseline(buildQueueSnapshot(rows, nextMaxP, currentConfig?.active_model ?? 0))
      setTestResults({})
      setProbeResults({})
      if (full.length === 0) setExpandedIdx(0)
    } catch {
      useInterviewStore.getState().setToastMessage('加载模型列表失败')
    } finally {
      setLoading(false)
    }
  }, [resetQueueBaseline])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  useEffect(() => {
    if (!config?.models?.length) return
    const nextLlmForm = {
      temperature: config.temperature,
      max_tokens: config.max_tokens,
      think_mode: config.think_mode ?? false,
      think_effort: config.think_effort ?? 'off',
    }
    const nextMaxP = Math.min(8, Math.max(1, config.max_parallel_answers ?? 2))
    if (!queueDirty) {
      setMaxP(nextMaxP)
      resetQueueBaseline(buildQueueSnapshot(modelRows, nextMaxP, config.active_model ?? 0))
    }
    if (!llmDirty) {
      setLlmForm(nextLlmForm)
      resetLlmBaseline(nextLlmForm)
    }
    void syncHealthFromServer()
  }, [
    config,
    llmDirty,
    modelRows,
    queueDirty,
    resetLlmBaseline,
    resetQueueBaseline,
    syncHealthFromServer,
  ])

  useEffect(() => {
    const idx = expandedIdx
    if (idx === null || pendingFocusIdx.current !== idx) return
    const timer = window.setTimeout(() => {
      rowRefs.current[idx]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
      nameInputRefs.current[idx]?.focus()
      pendingFocusIdx.current = null
    }, 60)
    return () => window.clearTimeout(timer)
  }, [expandedIdx, modelRows.length])

  const clearRemoteModelList = (rowId: string) => {
    remoteModelRequestVersions.current[rowId] = (remoteModelRequestVersions.current[rowId] ?? 0) + 1
    setRemoteModelLists((prev) => {
      if (!(rowId in prev)) return prev
      const next = { ...prev }
      delete next[rowId]
      return next
    })
  }

  const clearModelProbeState = (idx: number) => {
    setTestResults((prev) => {
      if (!(idx in prev)) return prev
      const next = { ...prev }
      delete next[idx]
      return next
    })
    setProbeResults((prev) => {
      if (!(idx in prev)) return prev
      const next = { ...prev }
      delete next[idx]
      return next
    })
  }

  const updateModel = (idx: number, patch: Partial<ModelFullInfo>) => {
    const rowId = modelRows[idx]?.id
    if (rowId && ('api_base_url' in patch || 'api_key' in patch)) {
      clearRemoteModelList(rowId)
    }
    if ('model' in patch) {
      clearModelProbeState(idx)
    }
    setModelRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, model: { ...row.model, ...patch } } : row)),
    )
  }

  const handleFetchRemoteModels = async (idx: number) => {
    const row = modelRows[idx]
    if (!row) return
    const rowId = row.id
    const requestKey = remoteModelRequestKey(row.model)
    const requestVersion = (remoteModelRequestVersions.current[rowId] ?? 0) + 1
    remoteModelRequestVersions.current[rowId] = requestVersion
    const requestStillCurrent = () => {
      const currentRow = modelRowsRef.current[idx]
      return !!currentRow
        && currentRow.id === rowId
        && remoteModelRequestVersions.current[rowId] === requestVersion
        && remoteModelRequestKey(currentRow.model) === requestKey
    }
    setRemoteModelLists((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] ?? EMPTY_REMOTE_MODEL_LIST), loading: true, error: null, loaded: false, requestKey },
    }))
    try {
      const result = await api.listRemoteModels({
        api_base_url: row.model.api_base_url,
        api_key: apiKeyPayloadValue(row.model),
        model_index: row.originalIndex,
      })
      setRemoteModelLists((prev) => {
        const currentRow = modelRowsRef.current[idx]
        if (!currentRow || currentRow.id !== rowId || remoteModelRequestKey(currentRow.model) !== requestKey) {
          return prev
        }
        return {
          ...prev,
          [rowId]: {
            loading: false,
            models: result.models ?? [],
            error: null,
            loaded: true,
            requestKey,
          },
        }
      })
      if (!result.models?.length && requestStillCurrent()) {
        useInterviewStore.getState().setToastMessage('接口未返回可选模型')
      }
    } catch (e: any) {
      const message = formatRemoteModelError(e)
      setRemoteModelLists((prev) => {
        const currentRow = modelRowsRef.current[idx]
        if (!currentRow || currentRow.id !== rowId || remoteModelRequestKey(currentRow.model) !== requestKey) {
          return prev
        }
        return {
          ...prev,
          [rowId]: {
            loading: false,
            models: [],
            error: message,
            loaded: true,
            requestKey,
          },
        }
      })
      if (requestStillCurrent()) {
        useInterviewStore.getState().setToastMessage(message)
      }
    }
  }

  const handleSelectRemoteModel = (idx: number, modelId: string) => {
    if (!modelId) return
    updateModel(idx, { model: modelId, name: modelId })
  }

  const addModel = () => {
    const nextIdx = modelRows.length
    pendingFocusIdx.current = nextIdx
    setModelRows((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${prev.length}`,
        originalIndex: prev.length,
        model: { ...EMPTY_MODEL },
      },
    ])
    setExpandedIdx(nextIdx)
  }

  const removeModel = (idx: number) => {
    if (modelRows.length <= 1) {
      useInterviewStore.getState().setToastMessage('至少保留一个模型')
      return
    }
    setModelRows((prev) => prev.filter((_, i) => i !== idx))
    if (modelRows[idx]) clearRemoteModelList(modelRows[idx].id)
    setExpandedIdx(null)
  }

  const buildModelPayload = (rows = modelRows) => buildModelPayloadFromRows(rows)

  const resolveActiveIndex = () => {
    const activeOriginalIndex = config?.active_model ?? 0
    const nextActiveIndex = modelRows.findIndex((row) => row.originalIndex === activeOriginalIndex)
    return nextActiveIndex >= 0 ? nextActiveIndex : 0
  }

  const handleSaveModels = async (quiet = false, collapse = true) => {
    const invalid = modelRows.find((row) => !row.model.name.trim())
    if (invalid) {
      useInterviewStore.getState().setToastMessage('模型名称不能为空')
      setQueueSaveState('error')
      setQueueSaveError('模型名称不能为空')
      return { ok: false as const }
    }
    setSaving(true)
    setQueueSaveState('saving')
    setQueueSaveError(null)
    try {
      const savedActiveIndex = resolveActiveIndex()
      const rowsToSave = modelRows.map((row, index) => ({
        ...row,
        id: `${index}:${row.model.name}:${row.model.model}:${row.model.api_base_url}`,
        model: {
          ...row.model,
          has_key: row.model.has_key || row.model.api_key.trim().length > 0,
        },
      }))
      const savedRows = rowsToSave.map((row, index) => ({
        ...row,
        originalIndex: index,
        model: { ...row.model, api_key: '' },
      }))
      await updateConfigAndRefresh({
        models: buildModelPayload(rowsToSave),
        active_model: savedActiveIndex,
        max_parallel_answers: maxP,
      })
      setModelRows(savedRows)
      markQueueSaved(buildQueueSnapshot(savedRows, maxP, savedActiveIndex))
      setQueueSaveState('saved')
      if (collapse) setExpandedIdx(null)
      setProbeResults({})
      if (!quiet) {
        useInterviewStore.getState().setToastMessage('模型队列已保存')
      }
      return {
        ok: true as const,
        rows: savedRows,
        activeModelIndex: savedActiveIndex,
      }
    } catch (e: any) {
      const message = e?.message ?? '保存失败'
      setQueueSaveError(message)
      setQueueSaveState('error')
      useInterviewStore.getState().setToastMessage(message)
      return { ok: false as const }
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
      const saveResult = await handleSaveModels(true, false)
      if (!saveResult.ok) {
        setTestResults((prev) => ({ ...prev, [idx]: 'error' }))
        useInterviewStore.getState().setModelHealth(idx, 'error', '请先修复模型配置保存失败的问题')
        setExpandedIdx(idx)
        return
      }
      const baseRows = saveResult.rows
      const activeModelIndex = saveResult.activeModelIndex
      const result = await api.probeModelCapabilities(idx)
      setProbeResults((prev) => ({ ...prev, [idx]: result }))
      const status = result.ok ? 'ok' : 'error'
      setTestResults((prev) => ({ ...prev, [idx]: status }))
      useInterviewStore.getState().setModelHealth(idx, status, result.detail, result.latency_ms)
      if (result.ok) {
        const nextRows = baseRows.map((row, i) =>
          i === idx
            ? {
                ...row,
                model: {
                  ...row.model,
                  supports_vision: result.supports_vision,
                  supports_think: result.supports_think,
                  think_enabled_params: result.think_params ?? {},
                  think_disabled_params: result.think_disabled_params ?? {},
                },
              }
            : row,
        )
        setModelRows(nextRows)
        await updateConfigAndRefresh({
          models: buildModelPayload(nextRows),
          active_model: activeModelIndex,
          max_parallel_answers: maxP,
        })
        markQueueSaved(buildQueueSnapshot(nextRows, maxP, activeModelIndex))
        setQueueSaveState('saved')
        const visionLabel = result.supports_vision ? '识图支持' : '识图未检测到'
        const thinkLabel = result.supports_think ? `Think ${result.think_style || '支持'}` : 'Think 未检测到'
        useInterviewStore.getState().setToastMessage(`连接可用，已自动更新：${visionLabel} · ${thinkLabel}`)
      } else {
        setExpandedIdx(idx)
        useInterviewStore.getState().setToastMessage(result.detail ? `连接失败：${result.detail}` : '连接失败')
      }
    } catch (e: any) {
      const detail = e?.message ?? '检测失败'
      setTestResults((prev) => ({ ...prev, [idx]: 'error' }))
      useInterviewStore.getState().setModelHealth(idx, 'error', detail)
      setExpandedIdx(idx)
      useInterviewStore.getState().setToastMessage(detail)
    } finally {
      setTestingIdx(null)
    }
  }

  const runHealthCheck = async () => {
    setHealthChecking(true)
    try {
      const saveResult = await handleSaveModels(true)
      if (!saveResult.ok) return
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
    setLlmSaveState('saving')
    setLlmSaveError(null)
    try {
      await updateConfigAndRefresh(llmForm)
      markLlmSaved(llmForm)
      setLlmSaveState('saved')
      useInterviewStore.getState().setToastMessage('LLM 参数已保存')
    } catch (e: any) {
      const message = e?.message ?? '保存失败'
      setLlmSaveError(message)
      setLlmSaveState('error')
      useInterviewStore.getState().setToastMessage(message)
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
  const effectiveQueueSaveState: SaveState = queueSaveState === 'saving' || queueSaveState === 'error'
    ? queueSaveState
    : queueDirty
      ? 'dirty'
      : queueSaveState === 'saved'
        ? 'saved'
        : 'idle'
  const effectiveLlmSaveState: SaveState = llmSaveState === 'saving' || llmSaveState === 'error'
    ? llmSaveState
    : llmDirty
      ? 'dirty'
      : llmSaveState === 'saved'
        ? 'saved'
        : 'idle'

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
              <SaveStateBadge mode="explicit" state={effectiveQueueSaveState} error={queueSaveError} />
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
              const probe = probeResults[idx]
              const testFailureDetail = st === 'error' ? (probe?.detail || healthDetail || '').trim() : ''
              const keyLabel = keyHasValue ? '已填写' : '未配置'
              const healthTitle = healthDetail ? `模型连接详情：${healthDetail}` : undefined
              const probeTitle = probe
                ? `识图：${probe.vision_detail || (probe.supports_vision ? '支持' : '未检测到')}\nThink 开启：${probe.think_detail || (probe.supports_think ? '支持' : '未检测到')}\nThink 关闭：${probe.think_disabled_detail || '未检测'}\n开启参数：${JSON.stringify(probe.think_params ?? {})}\n关闭参数：${JSON.stringify(probe.think_disabled_params ?? {})}`
                : undefined
              const remoteList = remoteModelLists[row.id] ?? EMPTY_REMOTE_MODEL_LIST
              const remoteModelGroups = groupRemoteModels(remoteList.models)
              const thinkDisabledParams = probe?.think_disabled_params ?? {}
              const hasThinkDisabledParams = Object.keys(thinkDisabledParams).length > 0
              const thinkDisableConfirmed = hasThinkDisabledParams || Boolean(probe?.think_disabled_detail?.includes('无需额外参数'))
              const needsThinkDisableProbe = probe?.supports_think && !thinkDisableConfirmed
              const thinkDisabledLabel = hasThinkDisabledParams
                ? `关 ${JSON.stringify(thinkDisabledParams)}`
                : needsThinkDisableProbe
                  ? '关 未确认'
                  : probe?.think_disabled_detail?.includes('无需额外参数')
                    ? '关 无需额外参数'
                    : `关 ${JSON.stringify(thinkDisabledParams)}`

              return (
                <div
                  key={row.id}
                  ref={(node) => {
                    rowRefs.current[idx] = node
                  }}
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

                  <div
                    aria-hidden={!isExpanded}
                    className={`grid transition-all duration-200 ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                  >
                    <div className="overflow-hidden">
                      <div className="px-4 pb-4 space-y-3 border-t border-bg-hover/50 pt-3">
                        <div className="grid sm:grid-cols-2 gap-3">
                          <Field label="模型名称 *">
                            <input
                              ref={(node) => {
                                nameInputRefs.current[idx] = node
                              }}
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
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={m.api_key}
                              onChange={(e) => updateModel(idx, { api_key: e.target.value, has_key: m.has_key })}
                              placeholder={apiKeyPlaceholder(m)}
                              className="input-field min-w-0 flex-1"
                            />
                            {m.has_key && (
                              <button
                                type="button"
                                onClick={() => updateModel(idx, { api_key: '', has_key: false })}
                                className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-accent-red/25 bg-accent-red/10 text-accent-red transition-colors hover:bg-accent-red/15"
                                title="清空已保存的 API Key"
                                aria-label="清空已保存的 API Key"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </Field>
                        <div className="rounded-xl border border-bg-hover/60 bg-bg-tertiary/30 px-3 py-3 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleFetchRemoteModels(idx)}
                              disabled={remoteList.loading}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-blue/30 bg-accent-blue/15 px-3 py-1.5 text-xs font-medium text-accent-blue transition-colors hover:bg-accent-blue/25 disabled:opacity-60"
                            >
                              {remoteList.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                              {remoteList.loading ? '获取中…' : '获取模型'}
                            </button>
                            <span className="text-[10px] leading-relaxed text-text-muted">
                              从当前 Base URL 和 API Key 读取可选模型，不会自动保存配置。
                            </span>
                          </div>
                          {remoteList.models.length > 0 && (
                            <select
                              value=""
                              onChange={(event) => handleSelectRemoteModel(idx, event.target.value)}
                              className="input-field"
                              aria-label="选择远端模型"
                            >
                              <option value="">选择模型</option>
                              {remoteModelGroups.map(([owner, models]) => (
                                <optgroup key={owner} label={owner}>
                                  {models.map((model) => (
                                    <option key={model.id} value={model.id}>
                                      {model.id}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          )}
                          {remoteList.loaded && remoteList.models.length === 0 && !remoteList.error && (
                            <p className="text-[11px] text-text-muted">接口未返回可选模型，仍可手动填写 Model ID。</p>
                          )}
                          {remoteList.error && (
                            <p role="alert" className="text-[11px] leading-relaxed text-accent-red">
                              {remoteList.error}
                            </p>
                          )}
                        </div>
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
                        {testFailureDetail && (
                          <div
                            role="alert"
                            className="rounded-lg border border-accent-red/25 bg-accent-red/10 px-3 py-2 text-xs leading-relaxed text-accent-red"
                          >
                            测试失败：{testFailureDetail}
                          </div>
                        )}
                        {probe && (
                          <div
                            className="flex flex-wrap items-center gap-2 rounded-lg border border-bg-hover/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-muted"
                            title={probeTitle}
                          >
                            <span className="text-text-secondary">自动探测</span>
                            <span className={probe.supports_vision ? 'text-sky-300' : 'text-text-muted'}>
                              识图 {probe.supports_vision ? '支持' : '未检测到'}
                            </span>
                            <span className={probe.supports_think ? 'text-emerald-300' : 'text-text-muted'}>
                              Think {probe.supports_think ? (probe.think_style || '支持') : '未检测到'}
                            </span>
                            {probe.supports_think && (
                              <span className="max-w-full truncate font-mono text-[10px] text-text-muted">
                                开 {JSON.stringify(probe.think_params)}
                              </span>
                            )}
                            <span className={`max-w-full truncate font-mono text-[10px] ${needsThinkDisableProbe ? 'text-amber-300' : 'text-text-muted'}`}>
                              {thinkDisabledLabel}
                            </span>
                            {needsThinkDisableProbe && (
                              <button
                                type="button"
                                onClick={() => handleTestModel(idx)}
                                disabled={testingIdx !== null || !on}
                                className="rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-amber-400/15 disabled:opacity-50"
                                title="重新保存配置并探测 Think 关闭参数"
                              >
                                重新探测
                              </button>
                            )}
                          </div>
                        )}
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
                            <span className="max-w-[180px] text-[10px] leading-relaxed text-text-muted">
                              测试会先保存当前模型配置
                            </span>
                            <button
                              type="button"
                              onClick={() => handleTestModel(idx)}
                              disabled={testingIdx !== null || !on}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue/15 hover:bg-accent-blue/25 border border-accent-blue/30 text-accent-blue text-xs font-medium transition-colors disabled:opacity-60"
                              title={on ? '测试该模型连接' : '请先启用该模型'}
                            >
                              {testingIdx === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                              {testingIdx === idx ? '测试中…' : '保存并测试'}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-accent-blue" />
            生成参数
          </h3>
          <SaveStateBadge mode="explicit" state={effectiveLlmSaveState} error={llmSaveError} />
        </div>
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
              setLlmForm({ ...llmForm, think_mode: next, think_effort: next ? 'xhigh' : 'off' })
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
