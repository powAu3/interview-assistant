import { useEffect, useRef } from 'react'
import { Mic, MicOff, Activity } from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'

export default function TranscriptionPanel() {
  const { transcriptions, isRecording, audioLevel, isTranscribing } = useInterviewStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcriptions])

  const levelPercent = Math.min(audioLevel * 500, 100)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-bg-tertiary flex-shrink-0">
        <div className="flex items-center gap-2">
          {isRecording ? (
            <Mic className="w-4 h-4 text-accent-green" />
          ) : (
            <MicOff className="w-4 h-4 text-text-muted" />
          )}
          <span className="text-sm font-medium">实时转录</span>
        </div>
        {isRecording && (
          <div className="flex items-center gap-2 ml-auto">
            {isTranscribing && (
              <span className="flex items-center gap-1 text-xs text-accent-amber">
                <Activity className="w-3 h-3 animate-pulse" />
                转写中
              </span>
            )}
            <div className="w-16 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-green rounded-full transition-all duration-100"
                style={{ width: `${levelPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {transcriptions.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted text-sm text-center">
              {isRecording
                ? '等待语音输入...'
                : '点击「开始面试」以开始录音'}
            </p>
          </div>
        ) : (
          transcriptions.map((text, i) => (
            <div
              key={i}
              className="px-3 py-2 rounded-lg bg-bg-tertiary/50 text-sm leading-relaxed text-text-primary"
            >
              <span className="text-accent-blue font-medium mr-1.5">面试官:</span>
              {text}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
