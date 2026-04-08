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
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-bg-tertiary/60 flex-shrink-0">
        <div className="flex items-center gap-2">
          {isRecording ? (
            <div className="relative">
              <Mic className="w-4 h-4 text-accent-green" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent-green recording-pulse" />
            </div>
          ) : (
            <MicOff className="w-4 h-4 text-text-muted" />
          )}
          <span className="text-sm font-semibold tracking-tight">
            {isRecording ? '正在录音' : '实时转录'}
          </span>
        </div>
        {isRecording && (
          <div className="flex items-center gap-2.5 ml-auto">
            {isTranscribing && (
              <span className="flex items-center gap-1 text-xs text-accent-amber font-medium">
                <Activity className="w-3 h-3 animate-pulse" />
                转写中
              </span>
            )}
            <div className="flex items-end gap-[2px] h-4">
              {[0.6, 1.0, 0.75, 0.9, 0.5].map((scale, i) => (
                <div
                  key={i}
                  className="w-[3px] rounded-full bg-accent-green/80 transition-all duration-75"
                  style={{
                    height: `${Math.max(15, Math.min(100, levelPercent * scale))}%`,
                    opacity: levelPercent > 5 ? 0.5 + (levelPercent / 200) : 0.2,
                  }}
                />
              ))}
            </div>
            <span className="text-[10px] text-text-muted font-mono tabular-nums w-8 text-right">
              {Math.round(levelPercent)}%
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {transcriptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-12 h-12 rounded-2xl bg-bg-tertiary/50 flex items-center justify-center">
              {isRecording ? (
                <Activity className="w-5 h-5 text-accent-amber animate-pulse" />
              ) : (
                <Mic className="w-5 h-5 text-text-muted/50" />
              )}
            </div>
            <div className="text-center">
              <p className="text-text-muted text-sm font-medium">
                {isRecording ? '等待语音输入...' : '实时语音转录'}
              </p>
              <p className="text-text-muted/60 text-xs mt-1">
                {isRecording ? '检测到语音后将自动转录' : '点击下方「开始面试」启动录音'}
              </p>
            </div>
          </div>
        ) : (
          transcriptions.map((text, i) => (
            <div
              key={i}
              className="transcription-item px-3.5 py-2.5 rounded-lg bg-bg-tertiary/40 text-sm leading-relaxed text-text-primary"
              style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
            >
              <span className="text-accent-blue/70 font-mono mr-1.5 text-[10px] select-none">{String(i + 1).padStart(2, '0')}</span>
              {text}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
