import { useEffect, useRef } from 'react'
import { Mic, MicOff, Activity, Volume2, Radio, Languages } from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'

export default function TranscriptionPanel() {
  const transcriptions = useInterviewStore((s) => s.transcriptions)
  const isRecording = useInterviewStore((s) => s.isRecording)
  const audioLevel = useInterviewStore((s) => s.audioLevel)
  const isTranscribing = useInterviewStore((s) => s.isTranscribing)
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
            <div className="relative w-14 h-14">
              <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br from-accent-blue/15 to-accent-green/10 ${isRecording ? 'animate-glow' : ''}`} />
              <div className="relative flex items-center justify-center w-14 h-14 rounded-2xl bg-bg-tertiary/50">
                {isRecording ? (
                  <Activity className="w-6 h-6 text-accent-amber animate-pulse" />
                ) : (
                  <Mic className="w-6 h-6 text-text-muted/60" />
                )}
              </div>
            </div>
            <div className="text-center space-y-1">
              <p className="text-text-primary text-sm font-semibold">
                {isRecording ? '等待语音输入…' : '实时语音转录'}
              </p>
              <p className="text-text-muted text-xs leading-relaxed">
                {isRecording
                  ? '检测到语音会自动分段转录,问题会发给 AI 生成答案'
                  : '选择音频设备后,点击「开始面试」启动实时识别'}
              </p>
            </div>
            {!isRecording && (
              <div className="flex items-center gap-1.5 flex-wrap justify-center pt-1">
                {[
                  { icon: Volume2, label: '会议拾音', hint: '优先选 BlackHole / 系统音频 (loopback), 可录远端声音' },
                  { icon: Radio, label: '自动断句', hint: 'VAD 静音超阈值即切段并识别' },
                  { icon: Languages, label: '中英混读', hint: '默认中文优先, 英文术语保留原样' },
                ].map(({ icon: Icon, label, hint }) => (
                  <span
                    key={label}
                    title={hint}
                    className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-bg-tertiary/50 border border-bg-hover/40 text-text-secondary"
                  >
                    <Icon className="w-3 h-3 text-accent-blue/70" />
                    {label}
                  </span>
                ))}
              </div>
            )}
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
