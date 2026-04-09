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
  const latestIndex = transcriptions.length - 1

  return (
    <div className="ia-console-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[24px]">
      <div className="ia-console-topbar flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-accent-blue/15 bg-gradient-to-br from-accent-blue/15 to-transparent">
              {isRecording ? (
                <div className="relative">
                  <Mic className="h-4 w-4 text-accent-green" />
                  <span className="recording-pulse absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent-green" />
                </div>
              ) : (
                <MicOff className="h-4 w-4 text-text-muted" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">Transcription timeline</p>
              <h2 className="text-sm font-semibold tracking-tight text-text-primary md:text-[15px]">
                {isRecording ? '实时语音时间线' : '转录控制台'}
              </h2>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
            isRecording
              ? 'border-accent-green/25 bg-accent-green/10 text-accent-green'
              : 'border-bg-hover/60 bg-bg-tertiary/30 text-text-muted'
          }`}>
            {isRecording ? 'Live capture' : 'Idle'}
          </div>
          <div className="flex items-center gap-2 rounded-full border border-bg-hover/60 bg-bg-tertiary/25 px-3 py-1.5">
            <div className="flex h-4 items-end gap-[2px]">
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
            <span className="w-8 text-right font-mono text-[10px] tabular-nums text-text-muted">
              {Math.round(levelPercent)}%
            </span>
          </div>
          {isTranscribing && (
            <div className="flex items-center gap-1.5 rounded-full border border-accent-amber/25 bg-accent-amber/10 px-3 py-1 text-[11px] font-medium text-accent-amber">
              <Activity className="h-3.5 w-3.5 animate-pulse" />
              转写中
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 md:px-4 md:py-4">
        {transcriptions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 rounded-[22px] border border-dashed border-bg-hover/70 bg-bg-tertiary/10 px-5 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-[20px] border border-bg-hover/60 bg-bg-tertiary/25">
              {isRecording ? (
                <Activity className="h-6 w-6 animate-pulse text-accent-amber" />
              ) : (
                <Mic className="h-6 w-6 text-text-muted/60" />
              )}
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-text-primary">
                {isRecording ? '等待新的语音片段…' : '转录时间线尚未开始'}
              </p>
              <p className="mx-auto max-w-sm text-xs leading-relaxed text-text-secondary">
                {isRecording
                  ? '检测到语音后会按时间顺序落入时间线，方便长会话下快速回看上下文。'
                  : '点击下方主控制区的「开始面试」后，这里会持续记录新的语音转写片段。'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {transcriptions.map((text, i) => {
              const isLatest = i === latestIndex
              return (
                <article
                  key={i}
                  className="ia-timeline-item rounded-[22px] px-4 py-3.5 pl-5 animate-fade-up"
                  style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-2 pt-0.5">
                      <span className="ia-timeline-index text-[10px] font-semibold">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          isLatest && isRecording
                            ? 'bg-accent-amber animate-pulse'
                            : 'bg-accent-blue/60'
                        }`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                          {isLatest ? 'Latest segment' : 'Captured segment'}
                        </p>
                        {isLatest && isRecording && (
                          <span className="rounded-full border border-accent-green/25 bg-accent-green/10 px-2 py-0.5 text-[10px] font-medium text-accent-green">
                            正在监听
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed text-text-primary md:text-[15px]">{text}</p>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
