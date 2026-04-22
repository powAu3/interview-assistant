import { Loader2, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import { VirtualInterviewer } from '@/components/practice/VirtualInterviewer'
import type { PracticeSessionSnapshot, PracticeStatus } from '@/stores/configStore'
import { resolveVirtualInterviewerPersona } from '@/components/practice/virtualInterviewerPersona'

interface PracticeDebriefViewProps {
  activePersona: ReturnType<typeof resolveVirtualInterviewerPersona>
  averageScore: number | null
  completedTurns: PracticeSessionSnapshot['turn_history']
  handleReset: () => Promise<void>
  practiceSession: PracticeSessionSnapshot | null
  practiceStatus: PracticeStatus
}

export function PracticeDebriefView(props: PracticeDebriefViewProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f7f3ea_0%,#efe5d5_100%)] px-4 py-6 text-[#10233a] md:px-6">
      <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[0.72fr_1.28fr]">
        <aside className="rounded-[28px] border border-[#10233a]/10 bg-[#10233a] p-5 text-[#f6efe4] shadow-[0_22px_60px_rgba(16,35,58,0.16)]">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8bb0d6]">Debrief</p>
          <h2
            className="mt-3 text-[2rem] leading-[1.05] tracking-[-0.04em]"
            style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif' }}
          >
            {props.practiceStatus === 'debriefing'
              ? '整场复盘正在生成，先把关键信息收口。'
              : '这场模拟面试已经结束，现在看整场复盘。'}
          </h2>
          {props.practiceStatus === 'debriefing' && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#f4b88a]/20 bg-[#f4b88a]/10 px-3 py-1.5 text-xs text-[#f6dcc0]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在生成整场复盘...
            </div>
          )}
          <div className="mt-6 grid gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[#8bb0d6]">面试官画像</p>
              <div className="mt-3 flex items-center gap-3">
                <VirtualInterviewer
                  data-testid="practice-interviewer-preview"
                  persona={props.activePersona.key}
                  state="debrief"
                  signal="wrap-up"
                  compact
                />
                <div className="min-w-0">
                  <p className="text-base font-semibold text-[#f4b88a]">{props.activePersona.label}</p>
                  <p className="mt-1 text-xs leading-6 text-[#dbcdb8]">{props.activePersona.summary}</p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#dbcdb8]">{props.activePersona.description}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[#8bb0d6]">总轮次</p>
              <p className="mt-2 text-2xl font-semibold text-[#f4b88a]">{props.completedTurns.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[#8bb0d6]">平均隐式评分</p>
              <p className="mt-2 text-2xl font-semibold text-[#f4b88a]">
                {props.averageScore == null ? '—' : `${props.averageScore}/10`}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[#8bb0d6]">JD 命中背景</p>
              <p className="mt-2 text-sm leading-6 text-[#dbcdb8]">
                {props.practiceSession?.context?.jd_text || '本轮未填写 JD，主要按岗位与简历推进。'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[#8bb0d6]">整体气质</p>
              <p className="mt-2 text-sm leading-6 text-[#dbcdb8]">{props.activePersona.projectBias}</p>
              <p className="mt-2 text-xs leading-6 text-[#b8ab95]">{props.activePersona.barRule}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={props.handleReset}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-[#f6efe4] transition hover:bg-white/8"
          >
            <RotateCcw className="h-4 w-4" />
            再来一场
          </button>
        </aside>

        <section className="rounded-[28px] border border-[#10233a]/10 bg-[linear-gradient(140deg,#fffaf1_0%,#f3ebdd_64%,#eee1ce_100%)] p-5 shadow-[0_22px_60px_rgba(16,35,58,0.10)]">
          <div className="flex flex-wrap gap-2">
            {props.completedTurns.map((turn) => (
              <span
                key={turn.turn_id}
                className="rounded-full border border-[#10233a]/10 bg-white/70 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#335d88]"
              >
                {turn.phase_label}
              </span>
            ))}
          </div>
          {props.completedTurns.length > 0 && (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {props.completedTurns.map((turn, index) => (
                <div key={turn.turn_id} className="rounded-2xl border border-[#10233a]/10 bg-white/65 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-[#335d88]">
                      Round {index + 1} · {turn.phase_label}
                    </span>
                    <span className="text-xs text-[#6a7c91]">{turn.decision || 'advance'}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#23384f]">{turn.question}</p>
                  {turn.transition_line && (
                    <p className="mt-2 text-[11px] leading-5 text-[#7c6b54]">{turn.transition_line}</p>
                  )}
                  {turn.scorecard && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {Object.entries(turn.scorecard).map(([key, value]) => (
                        <span
                          key={key}
                          className="rounded-full border border-[#10233a]/8 bg-[#fffdf8] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#42556c]"
                        >
                          {key}: {value}/10
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="prose prose-sm mt-5 max-w-none text-[#23384f] prose-headings:text-[#10233a] prose-strong:text-[#10233a]">
            <ReactMarkdown>{props.practiceSession?.report_markdown || '正在整理本场表现与改进建议...'}</ReactMarkdown>
          </div>
        </section>
      </div>
    </div>
  )
}
