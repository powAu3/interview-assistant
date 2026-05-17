import { useState, useEffect, useCallback, useRef } from 'react'
import {
  AudioWaveform,
  Mic,
  Brain,
  Monitor,
  Wifi,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Star,
  RotateCcw,
  Sparkles,
  ChevronDown,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useInterviewStore } from '@/stores/configStore'
import { buildWsUrl } from '@/lib/backendUrl'

type StepStatus = 'idle' | 'running' | 'pass' | 'fail' | 'warn' | 'skip'

interface StepState {
  status: StepStatus
  detail: string
  answer?: string
  question?: string
  transcript?: string
  expected_phrase?: string
}

interface Scenario {
  id: string
  label: string
  question: string
  recommended: boolean
}

const STEP_META: { key: string; label: string; icon: typeof Mic }[] = [
  { key: 'playback', label: '播放测试音频', icon: AudioWaveform },
  { key: 'capture', label: '捕获输入音频', icon: Mic },
  { key: 'stt', label: '语音识别', icon: Mic },
  { key: 'match', label: '短句匹配', icon: CheckCircle2 },
  { key: 'llm', label: 'LLM 模型', icon: Brain },
  { key: 'ws', label: '实时推送', icon: Wifi },
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

export default function SoundTest() {
  const devices = useInterviewStore((s) => s.devices)
  const config = useInterviewStore((s) => s.config)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [selectedScenario, setSelectedScenario] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<Record<string, StepState>>({})
  const [done, setDone] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.preflightScenarios().then((res) => {
      setScenarios(res.scenarios)
      const rec = res.scenarios.find((s) => s.recommended)
      if (rec) setSelectedScenario(rec.id)
      else if (res.scenarios.length) setSelectedScenario(res.scenarios[0].id)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type !== 'preflight_step') return
      const { step, status, detail, answer, question, transcript, expected_phrase } = msg
      if (step === 'done') {
        setDone(true)
        setRunning(false)
        void api.preflightStatus().then((status) => {
          if (status?.captured_transcript || status?.expected_phrase) {
            setSteps((prev) => ({
              ...prev,
              match: {
                ...(prev.match ?? { status: 'idle', detail: '' }),
                transcript: status.captured_transcript ?? prev.match?.transcript,
                expected_phrase: status.expected_phrase ?? prev.match?.expected_phrase,
              },
            }))
          }
        }).catch(() => {})
        return
      }
      if (step === 'error') {
        setRunning(false)
        setErrorMsg(detail || '\u8bd5\u97f3\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u8bbe\u5907\u548c\u914d\u7f6e')
        return
      }
      setSteps((prev) => ({
        ...prev,
        [step]: { status, detail, answer, question, transcript, expected_phrase },
      }))
    } catch {}
  }, [])

  useEffect(() => {
    const ws = new WebSocket(buildWsUrl('/ws'))
    ws.onmessage = handleMessage
    return () => { ws.close() }
  }, [handleMessage])

  const selectedDevice = (() => {
    const loopback = devices.find((d) => d.is_loopback)
    return loopback?.id ?? devices[0]?.id ?? null
  })()

  const handleRun = async () => {
    setRunning(true)
    setDone(false)
    setSteps({})
    setErrorMsg(null)
    try {
      await api.preflightRun(selectedScenario, selectedDevice)
    } catch (e: any) {
      setRunning(false)
      setErrorMsg(e?.message || '\u8bd5\u97f3\u8bf7\u6c42\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u670d\u52a1\u662f\u5426\u542f\u52a8')
    }
  }

  const handleReset = () => {
    setSteps({})
    setDone(false)
    setRunning(false)
  }

  const allPassed = done && STEP_META.every((s) => {
    const st = steps[s.key]
    return st && (st.status === 'pass' || st.status === 'skip')
  })

  const llmAnswer = steps['llm']?.answer
  const llmQuestion = steps['llm']?.question
  const transcript = steps['match']?.transcript ?? steps['stt']?.transcript
  const expectedPhrase = steps['match']?.expected_phrase
  const selected = scenarios.find((s) => s.id === selectedScenario)

  const hasAnyResult = Object.keys(steps).length > 0

  return (
    <div className="preflight-panel animate-fade-up">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-blue/20 to-violet-500/15 text-accent-blue ring-1 ring-accent-blue/20">
          <AudioWaveform className="w-5 h-5" strokeWidth={2} />
        </div>
        <div>
          <h3 className="text-sm font-bold text-text-primary tracking-tight flex items-center gap-1.5">
            {'\u94FE\u8DEF\u68C0\u6D4B'}
            <Sparkles className="w-3 h-3 text-accent-amber/80" />
          </h3>
          <p className="text-[10px] text-text-muted mt-0.5">
            {'开始前，播放固定测试短句并检查 播放 → 捕获 → STT → LLM → 实时推送 是否畅通'}
          </p>
        </div>
      </div>

      {/* Scenario selector + Run button */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setShowDropdown(!showDropdown)}
            disabled={running}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-bg-hover/60 bg-bg-tertiary/40 text-xs text-text-primary hover:border-accent-blue/30 transition-colors disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5 truncate">
              {selected?.recommended && <Star className="w-3 h-3 text-accent-amber fill-accent-amber" />}
              {selected?.label ?? '选择 LLM 检测场景'}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
          </button>
          {showDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1 glass border border-bg-hover/50 rounded-xl shadow-xl shadow-black/20 z-50 py-1 animate-fade-up">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setSelectedScenario(s.id); setShowDropdown(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-bg-tertiary/50 ${
                    s.id === selectedScenario ? 'text-accent-blue bg-accent-blue/5' : 'text-text-primary'
                  }`}
                >
                  {s.recommended && <Star className="w-3 h-3 text-accent-amber fill-accent-amber flex-shrink-0" />}
                  <span className="flex-1 truncate">{s.label}</span>
                  <span className="text-[10px] text-text-muted truncate max-w-[120px]">{s.question}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {!hasAnyResult ? (
          <button
            type="button"
            onClick={handleRun}
            disabled={running || !selectedScenario}
            className="flex items-center gap-1.5 px-4 py-2 btn-primary text-xs font-semibold rounded-xl disabled:opacity-50 flex-shrink-0 whitespace-nowrap"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AudioWaveform className="w-3.5 h-3.5" />}
            {'\u5F00\u59CB\u68C0\u6D4B'}
          </button>
        ) : (
          <button
            type="button"
            onClick={done ? handleReset : undefined}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-2 btn-ghost text-xs font-medium rounded-xl disabled:opacity-50 flex-shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {'\u91CD\u65B0'}
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 text-xs text-accent-red bg-accent-red/10 px-3 py-2 rounded-lg mb-2">
          <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Pipeline steps */}
      <div className="grid grid-cols-2 gap-2">
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

      {expectedPhrase && (
        <div className="mt-3 rounded-xl border border-accent-blue/20 bg-accent-blue/5 p-3 animate-fade-up space-y-1">
          <p className="text-[10px] font-semibold text-accent-blue">固定测试短句</p>
          <p className="text-xs text-text-primary leading-relaxed">{expectedPhrase}</p>
          {transcript && (
            <>
              <p className="text-[10px] font-semibold text-text-muted pt-1">识别结果</p>
              <p className="text-xs text-text-primary leading-relaxed">{transcript}</p>
            </>
          )}
        </div>
      )}

      {/* LLM answer preview */}
      {llmAnswer && (
        <div className="mt-3 rounded-xl border border-accent-green/20 bg-accent-green/5 p-3 animate-fade-up">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Monitor className="w-3 h-3 text-accent-green" />
            <span className="text-[10px] font-semibold text-accent-green">{'UI \u5C55\u793A\u9A8C\u8BC1'}</span>
          </div>
          {llmQuestion && (
            <p className="text-[11px] text-text-muted mb-1">
              <span className="text-accent-blue font-semibold">Q:</span> {llmQuestion}
            </p>
          )}
          <p className="text-xs text-text-primary leading-relaxed line-clamp-3">{llmAnswer}</p>
        </div>
      )}

      {/* Summary */}
      {done && (
        <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium animate-fade-up ${
          allPassed
            ? 'bg-accent-green/10 text-accent-green border border-accent-green/20'
            : 'bg-accent-amber/10 text-accent-amber border border-accent-amber/20'
        }`}>
          {allPassed ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              {'链路畅通，可以开始了！'}
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4" />
              {'\u90E8\u5206\u73AF\u8282\u5F02\u5E38\uFF0C\u8BF7\u68C0\u67E5\u914D\u7F6E\u540E\u91CD\u8BD5'}
            </>
          )}
        </div>
      )}

      {/* Model info hint */}
      {!hasAnyResult && config && (
        <div className="mt-3 space-y-1 text-[10px] text-text-muted/70 px-1">
          <div>{'当前: '}{config.stt_provider} + {config.models?.[config.active_model]?.name ?? 'N/A'}</div>
          <div>{selectedDevice != null && devices.find((d) => d.id === selectedDevice)?.is_loopback ? '推荐使用系统音频设备进行真实链路检测' : '当前将使用默认设备进行真实链路检测'}</div>
        </div>
      )}
    </div>
  )
}
