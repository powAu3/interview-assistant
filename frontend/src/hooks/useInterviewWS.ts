import { useEffect, useRef } from 'react'
import { useInterviewStore } from '@/stores/configStore'

export function useInterviewWS() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number | null>(null)

  const connect = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`)
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
        handleMessage(JSON.parse(event.data))
      } catch {}
    }
    ws.onclose = () => {
      useInterviewStore.getState().setWsConnected(false)
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
          question: '',
          answer: '',
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
        // handled directly in PracticeMode component via store
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
      case 'resume_opt_start':
        s.setResumeOptLoading(true)
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
    }
  }

  useEffect(() => {
    connect()
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: 'ping' }))
    }, 30000)
    return () => {
      clearInterval(ping)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [])
}
