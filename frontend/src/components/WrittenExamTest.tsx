import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Brain,
  Camera,
  CheckCircle2,
  Code2,
  Loader2,
  Monitor,
  RotateCcw,
  Send,
  Sparkles,
  Wifi,
  XCircle,
} from 'lucide-react'
import { api } from '@/lib/api'
import { buildWsUrl } from '@/lib/backendUrl'
import { useInterviewStore } from '@/stores/configStore'

type StepStatus = 'idle' | 'running' | 'pass' | 'fail' | 'warn' | 'skip' | 'done'

interface StepState {
  status: StepStatus
  detail: string
  answer?: string
  question?: string
  first_token_ms?: number
  total_ms?: number
  model_name?: string
}

interface ExamPreflightStatus {
  running?: boolean
  steps?: unknown
  error?: unknown
  finished_at?: unknown
  preflight_id?: unknown
}

const FIXED_QUESTION = '代码题：给定整数数组 nums 和目标值 target，返回两数之和的下标。'

const STEP_META: { key: string; label: string; icon: typeof Code2 }[] = [
  { key: 'screenshot', label: '固定截图代码题', icon: Camera },
  { key: 'submit', label: '题目提交', icon: Send },
  { key: 'llm', label: 'LLM 模型', icon: Brain },
  { key: 'ws', label: '实时推送', icon: Wifi },
  { key: 'ui', label: 'UI 展示', icon: Monitor },
]

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-4 h-4 text-accent-blue animate-spin" />
    case 'pass':
      return <CheckCircle2 className="w-4 h-4 text-accent-green" />
    case 'fail':
      return <XCircle className="w-4 h-4 text-accent-red" />
    case 'warn':
      return <AlertTriangle className="w-4 h-4 text-accent-amber" />
    case 'skip':
      return <div className="w-4 h-4 rounded-full border-2 border-text-muted/30" />
    default:
      return <div className="w-4 h-4 rounded-full border-2 border-bg-hover" />
  }
}

function statusColor(status: StepStatus): string {
  switch (status) {
    case 'running': return 'border-accent-blue/40 bg-accent-blue/5'
    case 'pass': return 'border-accent-green/30 bg-accent-green/5'
    case 'fail': return 'border-accent-red/30 bg-accent-red/5'
    case 'warn': return 'border-accent-amber/30 bg-accent-amber/5'
    default: return 'border-bg-hover/50 bg-transparent'
  }
}

function formatLatency(ms?: number): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStatusSteps(value: unknown): Record<string, Partial<StepState>> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(([, step]) => isRecord(step)),
  ) as Record<string, Partial<StepState>>
}

export default function WrittenExamTest() {
  const config = useInterviewStore((s) => s.config)
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<Record<string, StepState>>({})
  const [done, setDone] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const activePreflightIdRef = useRef<string | null>(null)

  const setCurrentPreflightId = useCallback((preflightId: string | null) => {
    activePreflightIdRef.current = preflightId
  }, [])

  const hydrateStatus = useCallback(async () => {
    try {
      const status = await api.examPreflightStatus() as ExamPreflightStatus
      const statusSteps = normalizeStatusSteps(status?.steps)
      const isRunning = Boolean(status?.running)
      const isDone = !isRunning && statusSteps.done?.status === 'done'
      if (status?.preflight_id) {
        setCurrentPreflightId(String(status.preflight_id))
      }
      setSteps((prev) => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(statusSteps).map(([key, value]) => [
            key,
            { ...(prev[key] ?? { status: 'idle', detail: '' }), ...value },
          ]),
        ),
      }))
      setRunning(isRunning)
      setDone(isDone)
      setErrorMsg(status?.error ? String(status.error) : null)
    } catch {
      /* status hydration is best-effort; WS has the primary progress stream */
    }
  }, [setCurrentPreflightId])

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.exam_preflight_id) {
        const eventPreflightId = String(msg.exam_preflight_id)
        const currentPreflightId = activePreflightIdRef.current
        if (currentPreflightId && eventPreflightId !== currentPreflightId) return
        if (!currentPreflightId) setCurrentPreflightId(eventPreflightId)
        if (msg.type === 'answer_start') {
          setRunning(true)
          setSteps((prev) => ({
            ...prev,
            submit: {
              ...(prev.submit ?? { status: 'idle', detail: '' }),
              status: 'pass',
              detail: '真实答题 worker 已开始流式回答',
              question: FIXED_QUESTION,
              model_name: msg.model_name,
            },
            llm: {
              ...(prev.llm ?? { status: 'idle', detail: '' }),
              status: 'running',
              detail: '正在通过真实答题流生成代码答案…',
              question: FIXED_QUESTION,
              model_name: msg.model_name,
            },
            ws: { status: 'pass', detail: '已收到真实答题 WebSocket 事件' },
          }))
          return
        }
        if (msg.type === 'answer_chunk') {
          setSteps((prev) => ({
            ...prev,
            ws: { status: 'pass', detail: '已收到真实答题 WebSocket 流式片段' },
          }))
          return
        }
        if (msg.type === 'answer_done') {
          setRunning(false)
          setDone(true)
          setErrorMsg(null)
          setSteps((prev) => ({
            ...prev,
            llm: {
              status: 'pass',
              detail: `首 token ${msg.first_token_ms ?? 0}ms · 完整 ${msg.total_ms ?? 0}ms`,
              answer: msg.answer,
              question: FIXED_QUESTION,
              first_token_ms: msg.first_token_ms,
              total_ms: msg.total_ms,
              model_name: msg.model_name,
            },
            ws: { status: 'pass', detail: '真实答题 WebSocket 完整推送正常' },
            ui: { status: 'pass', detail: '真实答题结果已在检测面板渲染' },
          }))
          void hydrateStatus()
          return
        }
        if (msg.type === 'answer_error' || msg.type === 'answer_cancelled') {
          setRunning(false)
          setErrorMsg(msg.message || '笔试链路检测被取消或失败')
          return
        }
        return
      }
      if (msg.type !== 'exam_preflight_step') return
      const { step, status, detail, answer, question, first_token_ms, total_ms, model_name } = msg
      if (msg.preflight_id) {
        const eventPreflightId = String(msg.preflight_id)
        const currentPreflightId = activePreflightIdRef.current
        if (currentPreflightId && eventPreflightId !== currentPreflightId) return
        if (!currentPreflightId) setCurrentPreflightId(eventPreflightId)
      }
      if (step === 'done') {
        setDone(true)
        setRunning(false)
        void hydrateStatus()
        return
      }
      if (step === 'error') {
        setRunning(false)
        setErrorMsg(detail || '笔试链路检测失败，请检查模型配置')
        return
      }
      setSteps((prev) => ({
        ...prev,
        [step]: { status, detail, answer, question, first_token_ms, total_ms, model_name },
      }))
    } catch {
      /* ignore malformed WS frames */
    }
  }, [hydrateStatus, setCurrentPreflightId])

  useEffect(() => {
    const ws = new WebSocket(buildWsUrl('/ws'))
    ws.onmessage = handleMessage
    return () => { ws.close() }
  }, [handleMessage])

  useEffect(() => {
    void hydrateStatus()
  }, [hydrateStatus])

  const handleRun = async () => {
    setRunning(true)
    setDone(false)
    setSteps({})
    setErrorMsg(null)
    setCurrentPreflightId(null)
    try {
      await api.examPreflightRun()
    } catch (error: any) {
      setRunning(false)
      setErrorMsg(error?.message || '笔试链路检测请求失败，请确认后端服务已启动')
    }
  }

  const hasAnyResult = Object.keys(steps).length > 0
  const allPassed = done && STEP_META.every((s) => {
    const step = steps[s.key]
    return step && (step.status === 'pass' || step.status === 'skip')
  })

  const llmStep = steps.llm
  const llmAnswer = llmStep?.answer
  const llmQuestion = llmStep?.question ?? steps.submit?.question ?? FIXED_QUESTION
  const firstToken = formatLatency(llmStep?.first_token_ms)
  const total = formatLatency(llmStep?.total_ms)
  const modelName = llmStep?.model_name ?? steps.submit?.model_name ?? config?.model_name
  const hasVisionModel = Boolean(config?.models?.some((model) => model.enabled !== false && model.supports_vision))

  return (
    <div className="preflight-panel animate-fade-up">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-green/20 to-sky-500/15 text-accent-green ring-1 ring-accent-green/20">
          <Code2 className="w-5 h-5" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-text-primary tracking-tight flex items-center gap-1.5">
            链路检测
            <Sparkles className="w-3 h-3 text-accent-amber/80" />
          </h3>
          <p className="text-[10px] text-text-muted mt-0.5">
            开始前，跑固定截图代码题并检查 截图 → 提交 → LLM → 实时推送 → UI 展示
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 mb-4">
        <div className="flex-1 min-w-0 rounded-xl border border-accent-blue/20 bg-accent-blue/5 px-3 py-2">
          <div className="text-[10px] font-semibold text-accent-blue mb-1">固定截图代码题</div>
          <p className="text-xs text-text-primary leading-relaxed">{FIXED_QUESTION}</p>
        </div>

        {!hasAnyResult ? (
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-1.5 px-4 py-2 btn-primary text-xs font-semibold rounded-xl disabled:opacity-50 flex-shrink-0 whitespace-nowrap"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Code2 className="w-3.5 h-3.5" />}
            开始检测
          </button>
        ) : (
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-2 btn-ghost text-xs font-medium rounded-xl disabled:opacity-50 flex-shrink-0"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            重新
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 text-xs text-accent-red bg-accent-red/10 px-3 py-2 rounded-lg mb-2">
          <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {!hasVisionModel && !hasAnyResult && (
        <div className="flex items-center gap-2 text-xs text-accent-amber bg-accent-amber/10 px-3 py-2 rounded-lg mb-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>固定截图代码题需要支持视觉的模型。</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {STEP_META.map(({ key, label, icon: Icon }, i) => {
          const step = steps[key]
          const status = step?.status ?? 'idle'
          return (
            <div
              key={key}
              className={`relative rounded-xl border px-3 py-2.5 transition-all duration-300 ${statusColor(status)}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center gap-2">
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                  status === 'pass' ? 'bg-accent-green/15' :
                  status === 'fail' ? 'bg-accent-red/15' :
                  status === 'running' ? 'bg-accent-blue/15' :
                  'bg-bg-tertiary/50'
                }`}>
                  <Icon className={`w-3.5 h-3.5 ${
                    status === 'pass' ? 'text-accent-green' :
                    status === 'fail' ? 'text-accent-red' :
                    status === 'running' ? 'text-accent-blue' :
                    'text-text-muted/60'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-text-primary">{label}</span>
                    <StatusIcon status={status} />
                  </div>
                  {step?.detail && (
                    <p className="text-[10px] text-text-muted mt-0.5 line-clamp-1">{step.detail}</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {llmAnswer && (
        <div className="mt-3 rounded-xl border border-accent-green/20 bg-accent-green/5 p-3 animate-fade-up">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5">
              <Monitor className="w-3 h-3 text-accent-green" />
              <span className="text-[10px] font-semibold text-accent-green">UI 展示验证</span>
            </div>
            {(firstToken || total) && (
              <div className="flex items-center gap-1.5 text-[10px] text-text-muted whitespace-nowrap">
                {firstToken && <span>首 token {firstToken}</span>}
                {firstToken && total && <span className="text-text-muted/40">/</span>}
                {total && <span>完整 {total}</span>}
              </div>
            )}
          </div>
          <p className="text-[11px] text-text-muted mb-1">
            <span className="text-accent-blue font-semibold">Q:</span> {llmQuestion}
          </p>
          {modelName && (
            <p className="text-[10px] text-text-muted/80 mb-1">模型：{modelName}</p>
          )}
          <p className="text-xs text-text-primary leading-relaxed line-clamp-5 whitespace-pre-wrap">{llmAnswer}</p>
        </div>
      )}

      {done && (
        <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium animate-fade-up ${
          allPassed
            ? 'bg-accent-green/10 text-accent-green border border-accent-green/20'
            : 'bg-accent-amber/10 text-accent-amber border border-accent-amber/20'
        }`}>
          {allPassed ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              笔试链路畅通，可以开始了！
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4" />
              部分环节异常，请检查配置后重试
            </>
          )}
        </div>
      )}

      {!hasAnyResult && config && (
        <div className="mt-3 space-y-1 text-[10px] text-text-muted/70 px-1">
          <div>当前模型：{config.models?.[config.active_model]?.name ?? config.model_name ?? 'N/A'}</div>
          <div>检测会走固定截图代码题，不写入正式答题记录</div>
        </div>
      )}
    </div>
  )
}
