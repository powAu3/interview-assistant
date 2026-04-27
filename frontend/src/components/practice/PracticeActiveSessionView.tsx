import { Code2, Loader2, Mic, MicOff, RotateCcw, Send, Square, Volume2 } from 'lucide-react'

import { VirtualInterviewer } from '@/components/practice/VirtualInterviewer'
import type { DeviceItem, PracticePhase, PracticeSessionSnapshot } from '@/stores/configStore'
import { resolveVirtualInterviewerPersona } from '@/components/practice/virtualInterviewerPersona'
import type { PracticeTurn } from '@/stores/slices/types'

interface PracticeActiveSessionViewProps {
  completedTurns: PracticeSessionSnapshot['turn_history']
  currentPhaseLabel: string
  currentTurn: PracticeTurn | null
  error: string | null
  handleFinish: () => Promise<void>
  handleRecordToggle: () => Promise<void>
  handleReset: () => Promise<void>
  handleSubmit: () => Promise<void>
  interviewerSignalLabel: string
  interviewerState: 'speaking' | 'listening' | 'thinking' | 'idle' | 'debrief'
  interviewerStateLabel: string
  isWrittenPromptMode: boolean
  loading: boolean
  mics: DeviceItem[]
  phaseGuidance: { title: string; body: string }
  phases: PracticePhase[]
  practiceAnswerDraft: string
  practiceCodeDraft: string
  practiceElapsedMs: number
  practiceRecording: boolean
  practiceSession: PracticeSessionSnapshot | null
  practiceTtsSpeaking: boolean
  selectedMic: number | null
  setPracticeAnswerDraft: (text: string) => void
  setPracticeCodeDraft: (text: string) => void
  setSelectedMic: (value: number | null) => void
  sttLoaded: boolean
  ttsSourceLabel: string
  activePersona: ReturnType<typeof resolveVirtualInterviewerPersona>
  practiceTheme: 'light' | 'dark'
}

function stageLabel(index: number, total: number) {
  return `${Math.min(index + 1, total)}/${total}`
}

export function PracticeActiveSessionView(props: PracticeActiveSessionViewProps) {
  return (
    <div
      className="practice-page flex-1 overflow-y-auto px-4 py-5 md:px-6"
      data-practice-theme={props.practiceTheme}
    >
      <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <aside className="rounded-[28px] border border-[#10233a]/10 bg-[#10233a] p-5 text-[#f5efe2] shadow-[0_24px_70px_rgba(16,35,58,0.18)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#8bb0d6]">Interviewer Booth</p>
              <h2
                className="mt-3 text-[2rem] leading-[1.05] tracking-[-0.04em]"
                style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif' }}
              >
                {props.currentPhaseLabel}
              </h2>
              <p className="mt-3 text-sm leading-7 text-[#d9ccb6]">
                现在不是逐题打分训练，而是一场会自动推进的面试现场。
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#f2dfc3]">
                  风格 · {props.activePersona.label}
                </span>
                <span className="rounded-full border border-[#f4b88a]/18 bg-[#f4b88a]/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#f4c69e]">
                  状态 · {props.interviewerStateLabel}
                </span>
                <span className="rounded-full border border-[#8bb0d6]/20 bg-[#8bb0d6]/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#a8c3df]">
                  氛围 · {props.interviewerSignalLabel}
                </span>
                {props.isWrittenPromptMode && (
                  <span className="rounded-full border border-[#c77445]/18 bg-[#c77445]/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#f3c7a0]">
                    题面模式
                  </span>
                )}
              </div>
              <p className="mt-4 text-sm leading-7 text-[#cdbda5]">{props.activePersona.description}</p>
            </div>
            <VirtualInterviewer
              data-testid="practice-interviewer-preview"
              persona={props.activePersona.key}
              state={props.interviewerState}
              signal={props.currentTurn?.interviewer_signal}
              subtitle={props.currentTurn?.transition_line}
              writtenPromptMode={props.isWrittenPromptMode}
            />
          </div>

          <div className="mt-6 rounded-[26px] border border-white/10 bg-white/6 p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full border border-[#f4b88a]/25 bg-[#f4b88a]/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#f4c69e]">
                {props.currentTurn?.category ?? 'stage'}
              </span>
              <span className="text-xs text-[#8bb0d6]">
                {stageLabel(props.practiceSession?.current_phase_index ?? 0, props.phases.length || 1)}
              </span>
            </div>
            <p className="mt-4 text-[1.02rem] leading-8 text-[#f7f1e6]">{props.currentTurn?.question}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {props.phases.map((phase, index) => {
                const active = index === (props.practiceSession?.current_phase_index ?? 0)
                const done = index < (props.practiceSession?.current_phase_index ?? 0)
                return (
                  <span
                    key={`${phase.phase_id}-${index}`}
                    className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${
                      active
                        ? 'bg-[#f4b88a] text-[#10233a]'
                        : done
                          ? 'bg-white/14 text-[#f5efe2]'
                          : 'border border-white/10 text-[#8ea5bf]'
                    }`}
                  >
                    {phase.label}
                  </span>
                )
              })}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">当前展示层</p>
              <div className="mt-3 flex items-center gap-3 text-sm text-[#f7f1e6]">
                <Volume2 className="h-4 w-4 text-[#f4b88a]" />
                {props.interviewerStateLabel}
              </div>
              <div className="mt-2 text-xs text-[#cdbda5]">
                当前来源：{props.ttsSourceLabel}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">当前答题策略</p>
              <p className="mt-3 text-sm font-medium text-[#f7f1e6]">{props.phaseGuidance.title}</p>
              <p className="mt-2 text-xs leading-6 text-[#cdbda5]">{props.phaseGuidance.body}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">作答时长</p>
              <div className="mt-3 text-2xl font-semibold text-[#f4b88a]">
                {(props.practiceElapsedMs / 1000).toFixed(1)}s
              </div>
            </div>
          </div>
        </aside>

        <section className="rounded-[28px] border border-[#10233a]/10 bg-[linear-gradient(135deg,#fffaf1_0%,#f6efe3_58%,#efe5d3_100%)] p-5 shadow-[0_24px_70px_rgba(16,35,58,0.10)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#10233a]/8 pb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#335d88]">Candidate Workspace</p>
              <h3 className="mt-2 text-lg font-semibold text-[#10233a]">边说边写，把回答组织成真正能出口的结构。</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {props.sttLoaded && (
                <>
                  <select
                    value={props.selectedMic ?? ''}
                    onChange={(event) => props.setSelectedMic(Number(event.target.value))}
                    className="rounded-full border border-[#10233a]/10 bg-white/80 px-3 py-2 text-xs text-[#10233a] outline-none"
                  >
                    {props.mics.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={props.handleRecordToggle}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition ${
                      props.practiceRecording
                        ? 'bg-[#c74f2e] text-white'
                        : 'border border-[#10233a]/10 bg-white/80 text-[#10233a]'
                    }`}
                  >
                    {props.practiceRecording ? (
                      <>
                        <Square className="h-3.5 w-3.5" />
                        停止录音
                      </>
                    ) : (
                      <>
                        <Mic className="h-3.5 w-3.5" />
                        开始语音回答
                      </>
                    )}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={props.handleReset}
                className="inline-flex items-center gap-2 rounded-full border border-[#10233a]/10 px-4 py-2 text-xs text-[#42556c] transition hover:bg-white/70"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                退出
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
            <div className="space-y-4">
              <div className="rounded-[24px] border border-[#10233a]/8 bg-[#f3ede1]/65 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#10233a]/10 bg-white/80 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#335d88]">
                    answer mode · {props.currentTurn?.answer_mode ?? 'voice'}
                  </span>
                  {props.isWrittenPromptMode && (
                    <span className="rounded-full border border-[#c74f2e]/20 bg-[#c74f2e]/8 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#a94c35]">
                      题面模式
                    </span>
                  )}
                  {props.currentTurn?.follow_up_of && (
                    <span className="rounded-full border border-[#c74f2e]/20 bg-[#c74f2e]/8 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#a94c35]">
                      follow-up
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-6 text-[#42556c]">
                  {props.phaseGuidance.body}
                </p>
              </div>
              {(props.currentTurn?.written_prompt || props.currentTurn?.artifact_notes?.length) && (
                <div className="rounded-[24px] border border-[#10233a]/8 bg-[#f8f3ea] p-4">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[#335d88]">
                    <span>题面与元数据</span>
                    <span>{props.isWrittenPromptMode ? 'read-first' : 'reference'}</span>
                  </div>
                  {props.currentTurn?.written_prompt && (
                    <div className="mt-3 rounded-[22px] border border-[#10233a]/8 bg-white/75 px-4 py-3 text-sm leading-7 text-[#23384f]">
                      {props.currentTurn.written_prompt}
                    </div>
                  )}
                  {props.currentTurn?.artifact_notes?.length ? (
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-[#42556c]">
                      {props.currentTurn.artifact_notes.map((note: string, index: number) => (
                        <li key={`${note}-${index}`} className="flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#c74f2e]" />
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
              <div className="rounded-[24px] border border-[#10233a]/8 bg-white/78 p-4">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[#335d88]">
                  <span>实时回答草稿</span>
                  <span>{props.practiceAnswerDraft.length} chars</span>
                </div>
                <textarea
                  value={props.practiceAnswerDraft}
                  onChange={(event) => props.setPracticeAnswerDraft(event.target.value)}
                  rows={10}
                  placeholder="语音转写会持续写到这里，你也可以手动修句子，让它更像真正对面试官说出口的话。"
                  className="mt-3 w-full resize-none rounded-[22px] border border-[#10233a]/8 bg-[#fffdf8] px-4 py-3 text-sm leading-7 text-[#10233a] outline-none transition placeholder:text-[#7c8a9b] focus:border-[#335d88]/40"
                />
              </div>

              {(props.currentTurn?.answer_mode === 'voice+code' || props.currentTurn?.answer_mode === 'code') && (
                <div className="rounded-[24px] border border-[#10233a]/8 bg-[#10233a] p-4 text-[#f5efe3]">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">
                    <span className="inline-flex items-center gap-2">
                      <Code2 className="h-3.5 w-3.5" />
                      代码与结构区
                    </span>
                    <span>{props.practiceCodeDraft.length} chars</span>
                  </div>
                  <textarea
                    value={props.practiceCodeDraft}
                    onChange={(event) => props.setPracticeCodeDraft(event.target.value)}
                    rows={10}
                    placeholder="在这里补充 SQL / 伪代码 / 接口结构..."
                    className="mt-3 w-full resize-none rounded-[22px] border border-white/10 bg-[#0a1728] px-4 py-3 font-mono text-[13px] leading-6 text-[#f4ede1] outline-none transition placeholder:text-[#7f8ea3] focus:border-[#f4b88a]/40"
                  />
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-[24px] border border-[#10233a]/8 bg-white/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#335d88]">当前状态</p>
                <div className="mt-3 flex items-center gap-2 text-sm text-[#10233a]">
                  {props.practiceRecording ? <Mic className="h-4 w-4 text-[#c74f2e]" /> : <MicOff className="h-4 w-4 text-[#64748b]" />}
                  {props.practiceRecording ? '麦克风正在采集你的回答' : '当前未录音，可以先整理措辞后再提交'}
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm text-[#42556c]">
                  <Volume2 className="h-4 w-4 text-[#335d88]" />
                  {props.isWrittenPromptMode
                    ? '当前题型直接展示题面，不再默认口播'
                    : props.practiceTtsSpeaking
                      ? '面试官还在说话'
                      : '播报结束后会自动轮到你'}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#10233a]/8 bg-white/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#335d88]">已完成回合</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {props.completedTurns.length === 0 ? (
                    <span className="text-sm text-[#64748b]">这还是开场阶段，先把第一轮回答稳住。</span>
                  ) : (
                    props.completedTurns.map((turn) => (
                      <span
                        key={turn.turn_id}
                        className="rounded-full border border-[#10233a]/8 bg-[#fffdf8] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#42556c]"
                      >
                        {turn.phase_label}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#10233a]/8 bg-white/70 p-4">
                <button
                  type="button"
                  onClick={props.handleSubmit}
                  disabled={props.loading || (!props.practiceAnswerDraft.trim() && !props.practiceCodeDraft.trim())}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#10233a] px-5 py-3 text-sm font-semibold text-[#f6efe4] transition hover:bg-[#173252] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {props.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  提交本轮回答
                </button>
                <button
                  type="button"
                  onClick={props.handleFinish}
                  disabled={props.loading || props.completedTurns.length === 0}
                  className="mt-3 w-full rounded-full border border-[#10233a]/10 px-5 py-3 text-sm text-[#42556c] transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  提前结束并生成整场复盘
                </button>
              </div>
            </div>
          </div>

          {props.error && <p className="mt-4 text-sm text-[#c74f2e]">{props.error}</p>}
        </section>
      </div>
    </div>
  )
}
