import { useEffect, useRef } from 'react'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { useKbStore } from '@/stores/kbStore'
import { buildWsUrl } from '@/lib/backendUrl'
import { subscribeLeader } from '@/lib/wsLeader'

// scope -> 仅在该 appMode 下消费;assist / 全局消息不带 scope,任何模式都可见
const SCOPE_ALLOWED_MODES: Record<string, ReadonlySet<string>> = {
  practice: new Set(['practice']),
  'resume-opt': new Set(['resume-opt']),
}

function shouldDeliver(msg: { scope?: string }): boolean {
  const scope = msg.scope
  if (!scope) return true
  const allowed = SCOPE_ALLOWED_MODES[scope]
  if (!allowed) return true
  const mode = useUiPrefsStore.getState().appMode
  return allowed.has(mode)
}

export function useInterviewWS() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number | null>(null)
  const shouldReconnect = useRef(true)

  const connect = () => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN
      || wsRef.current?.readyState === WebSocket.CONNECTING
    ) return
    const ws = new WebSocket(buildWsUrl('/ws'))
    wsRef.current = ws

    ws.onopen = () => {
      useInterviewStore.getState().setWsConnected(true)
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
    }
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (!shouldDeliver(data)) return
        handleMessage(data)
      } catch {}
    }
    ws.onclose = () => {
      if (wsRef.current !== ws) return
      wsRef.current = null
      useInterviewStore.getState().setWsConnected(false)
      if (!shouldReconnect.current) return
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      reconnectTimer.current = window.setTimeout(connect, 2000)
    }
    ws.onerror = () => ws.close()
  }

  const handleMessage = (msg: any) => {
    const s = useInterviewStore.getState()
    switch (msg.type) {
      case 'init':
        s.setInitData(msg)
        break
      case 'recording':
        s.setRecording(msg.value)
        break
      case 'paused':
        s.setPaused(msg.value)
        break
      case 'audio_level':
        s.setAudioLevel(msg.value)
        break
      case 'transcribing':
        s.setTranscribing(msg.value)
        break
      case 'transcription':
        s.addTranscription(msg.text)
        break
      case 'session_cleared':
        s.clearSession()
        break
      case 'answer_start':
        s.startAnswer(msg.id, msg.question, {
          source: msg.source,
          modelName: msg.model_name,
        })
        break
      case 'answer_think_chunk':
        s.appendThinkChunk(msg.id, msg.chunk)
        break
      case 'answer_chunk':
        s.appendAnswerChunk(msg.id, msg.chunk)
        break
      case 'answer_done':
        s.finalizeAnswer(msg.id, msg.question, msg.answer, msg.think, msg.model_name)
        break
      case 'answer_cancelled':
        s.cancelAnswer(msg.id)
        break
      case 'vision_verify':
        s.setVisionVerify(msg.id, msg.verdict, msg.reason)
        break
      case 'stt_status':
        s.setSttStatus(msg.loaded ?? false, msg.loading ?? false)
        break
      // Practice mode messages
      case 'practice_status':
        s.setPracticeStatus(msg.status)
        break
      case 'practice_questions':
        s.setPracticeQuestions(msg.questions)
        break
      case 'practice_eval_start':
        break
      case 'practice_eval_chunk':
        s.appendPracticeEvalChunk(msg.chunk)
        break
      case 'practice_eval_done':
        s.finalizePracticeEval({
          question_id: msg.question_id,
          question: msg.question ?? '',
          answer: msg.answer ?? '',
          score: msg.score,
          feedback: msg.feedback,
        })
        break
      case 'practice_next':
        s.setPracticeIndex(msg.index)
        break
      case 'practice_report_start':
        break
      case 'practice_report_chunk':
        s.appendPracticeReportChunk(msg.chunk)
        break
      case 'practice_report_done':
        s.finalizePracticeReport(msg.report)
        break
      case 'practice_recording':
        s.setPracticeRecording(msg.value)
        break
      case 'practice_transcription':
        s.appendPracticeAnswerDraft(msg.text)
        break
      case 'model_health':
        s.setModelHealth(msg.index, msg.status)
        break
      case 'token_update':
        s.setTokenUsage({
          prompt: msg.prompt,
          completion: msg.completion,
          total: msg.total,
          byModel: msg.by_model ?? {},
        })
        break
      case 'model_fallback':
        s.setFallbackToast({ from: msg.from, to: msg.to, reason: msg.reason })
        break
      case 'stt_fallback':
        s.setFallbackToast({ from: `STT:${msg.from}`, to: `STT:${msg.to}`, reason: msg.reason })
        break
      case 'resume_opt_start':
        s.resetResumeOpt()
        s.setResumeOptLoading(true)
        break
      case 'resume_opt_chunk':
        s.appendResumeOptChunk(msg.chunk)
        break
      case 'resume_opt_done':
        s.setResumeOptResult(msg.text)
        s.setResumeOptLoading(false)
        break
      case 'error':
        s.setLastWSError(msg.message || '未知错误')
        setTimeout(() => useInterviewStore.getState().setLastWSError(null), 5000)
        break
      case 'kb_hits':
        useKbStore.getState().appendHits({
          qa_id: msg.qa_id,
          latency_ms: msg.latency_ms ?? 0,
          degraded: !!msg.degraded,
          hit_count: msg.hit_count ?? (Array.isArray(msg.hits) ? msg.hits.length : 0),
          hits: Array.isArray(msg.hits) ? msg.hits : [],
        })
        break
    }
  }

  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null

    const teardown = () => {
      shouldReconnect.current = false
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      if (wsRef.current) {
        try { wsRef.current.close() } catch { /* ignore */ }
        wsRef.current = null
      }
      useInterviewStore.getState().setWsConnected(false)
    }

    unsubscribe = subscribeLeader((isLeader) => {
      useInterviewStore.getState().setWsIsLeader(isLeader)
      if (isLeader) {
        shouldReconnect.current = true
        connect()
      } else {
        // 让出主控:断开 WS,store 回归只读
        teardown()
      }
    })

    pingTimer = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: 'ping' }))
    }, 30000)

    return () => {
      unsubscribe?.()
      if (pingTimer) clearInterval(pingTimer)
      teardown()
    }
  }, [])
}
