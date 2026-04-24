import { Loader2, RadioTower, Sparkles, Waves } from 'lucide-react'

import { VirtualInterviewer } from '@/components/practice/VirtualInterviewer'
import { ResumeMountPanel } from '@/components/resume/ResumeMount'
import { VIRTUAL_INTERVIEWER_PERSONA_OPTIONS as INTERVIEWER_STYLE_OPTIONS, resolveVirtualInterviewerPersona } from '@/components/practice/virtualInterviewerPersona'
import type { BrowserVoice } from '@/hooks/usePracticeVoiceCatalog'
import type { PracticeVoiceGender } from '@/lib/practiceTts'
import type { AppConfig } from '@/stores/configStore'

const PRACTICE_STAGE_PREVIEW = [
  '开场与岗位匹配',
  '项目深挖',
  '基础与八股',
  '设计与综合场景',
  '代码与 SQL',
  '收尾与反问',
]

interface PracticeSetupScreenProps {
  autoPreferredLocalVoice: BrowserVoice | null
  config: AppConfig | null
  error: string | null
  handleGenerate: () => Promise<void>
  interviewerStyle: string
  isPreparingView: boolean
  jdDraft: string
  loading: boolean
  selectedPersona: ReturnType<typeof resolveVirtualInterviewerPersona>
  selectedVoiceURI: string
  setInterviewerStyle: (value: string) => void
  setJdDraft: (value: string) => void
  setSelectedVoiceURI: (value: string) => void
  setVoiceGender: (value: PracticeVoiceGender) => void
  useEdgeTts: boolean
  voiceGender: PracticeVoiceGender
  voices: BrowserVoice[]
}

export function PracticeSetupScreen(props: PracticeSetupScreenProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#fbf8f0_0%,#f4efe3_46%,#efe6d6_100%)] text-[#122137]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:px-6 xl:grid xl:grid-cols-[1.05fr_0.95fr]">
        <section className="overflow-hidden rounded-[28px] border border-[#10233a]/10 bg-[linear-gradient(140deg,#fffaf1_0%,#f3ebdd_62%,#efe5d3_100%)] p-6 shadow-[0_24px_70px_rgba(16,35,58,0.10)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#10233a]/10 bg-white/65 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-[#335d88]">
                <RadioTower className="h-3.5 w-3.5" />
                Editorial Interview Booth
              </div>
              <h2
                className="max-w-2xl text-[2.1rem] font-semibold leading-[1.05] tracking-[-0.04em] text-[#10233a] md:text-[3rem]"
                style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif' }}
              >
                把“刷题器”换成一场真正会追问、会压场的模拟面试。
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[#42556c] md:text-[15px]">
                题目不再是一列静态清单。面试官会根据你的简历、岗位 JD、当前回答和阶段目标动态推进，
                结束后再统一复盘，不在中途打断你。
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[#10233a]/10 bg-white/80 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#335d88]">
                  当前风格 · {props.selectedPersona.label}
                </span>
                <span className="rounded-full border border-[#c77445]/15 bg-[#c77445]/8 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#8c5a39]">
                  {props.selectedPersona.summary}
                </span>
              </div>
            </div>
            <div className="w-full max-w-[260px]">
              <VirtualInterviewer
                data-testid="practice-interviewer-preview"
                persona={props.selectedPersona.key}
                state={props.isPreparingView ? 'speaking' : 'idle'}
                signal="warm-open"
                subtitle={props.selectedPersona.description}
              />
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              ['简历 + JD', '先看你投什么岗位，再决定切哪种题和追问。'],
              ['语音主链', '题目先播报，再自动轮到你回答，尽量保持现场感。'],
              ['整场复盘', '不再每题打断式点评，结束后给完整 debrief。'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-2xl border border-[#10233a]/8 bg-white/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c74f2e]">{title}</p>
                <p className="mt-2 text-sm leading-6 text-[#42556c]">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-[#10233a]/8 bg-white/72 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#335d88]">本场材料</p>
              <div className="mt-3 space-y-2 text-sm leading-6 text-[#42556c]">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[#10233a]/8 bg-[#fffaf1] px-3 py-2">
                  <span>简历</span>
                  <span className="max-w-[220px] truncate font-medium text-[#10233a]">
                    {props.config?.resume_active_filename || (props.config?.has_resume ? '简历已挂载' : '未挂载')}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[#10233a]/8 bg-[#fffaf1] px-3 py-2">
                  <span>JD</span>
                  <span className="font-medium text-[#10233a]">
                    {props.jdDraft.trim() ? `JD 已填写 · ${props.jdDraft.trim().length} chars` : '未填写，将按岗位默认出题'}
                  </span>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-[#10233a]/8 bg-white/72 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#335d88]">六段流程</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRACTICE_STAGE_PREVIEW.map((stage, index) => (
                  <span
                    key={stage}
                    className="rounded-full border border-[#10233a]/10 bg-[#fffaf1] px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-[#42556c]"
                  >
                    {index + 1}. {stage}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-[#10233a]/10 bg-[#10233a] p-5 text-[#f5efe3] shadow-[0_24px_70px_rgba(16,35,58,0.16)]">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f3ede1]/12">
              <Sparkles className="h-5 w-5 text-[#f4b88a]" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[#8bb0d6]">Scene Setup</p>
              <p className="mt-1 text-sm text-[#e7dcc7]/90">先把这场面试的上下文和播报风格定下来。</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">
                <span>目标岗位 JD</span>
                <span>{props.jdDraft.length} chars</span>
              </div>
              <textarea
                value={props.jdDraft}
                onChange={(event) => props.setJdDraft(event.target.value)}
                placeholder="粘贴目标岗位 JD，让问题更贴近真实岗位"
                rows={7}
                className="w-full resize-none rounded-2xl border border-white/10 bg-[#0d1d31] px-4 py-3 text-sm leading-6 text-[#f8f1e4] outline-none transition placeholder:text-[#8ca0b8] focus:border-[#f4b88a]/60"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">播报音色偏好</p>
                {props.useEdgeTts ? (
                  <>
                    <div className="mt-3 rounded-2xl border border-[#f4b88a]/25 bg-[#f4b88a]/10 px-3 py-3 text-sm leading-6 text-[#f8f1e4]">
                      当前主方案是 EdgeTTS。它更轻，不需要本地大模型环境；英文专有词和男/女声音色也更容易调。
                    </div>
                    <p className="mt-3 text-xs leading-6 text-[#c5b79f]">
                      它是在线神经语音，适合先把体验和音色调顺；火山引擎仍然保留为云端备选。
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {([
                        ['auto', '自动'],
                        ['female', '女声'],
                        ['male', '男声'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => props.setVoiceGender(value)}
                          className={`rounded-full px-3 py-1.5 text-xs transition ${
                            props.voiceGender === value
                              ? 'bg-[#f4b88a] text-[#10233a]'
                              : 'border border-white/10 bg-transparent text-[#d9ccb6]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-3 text-xs leading-6 text-[#c5b79f]">
                      云端方案后续只保留火山引擎 TTS；当前系统/browser 只做兜底。
                    </p>
                  </>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">面试官风格</p>
                <div className="mt-3 grid gap-2">
                  {INTERVIEWER_STYLE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => props.setInterviewerStyle(option.value)}
                      className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                        props.interviewerStyle === option.value
                          ? 'border-[#f4b88a]/50 bg-[#f4b88a]/10 text-[#f8f1e4]'
                          : 'border-white/10 bg-transparent text-[#d9ccb6]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <VirtualInterviewer
                          persona={option.value}
                          state={props.interviewerStyle === option.value ? 'listening' : 'idle'}
                          signal="warm-open"
                          compact
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold uppercase tracking-[0.14em]">{option.label}</div>
                          <div className="mt-1 text-[11px] leading-5 text-[#c5b79f]">{option.hint}</div>
                          <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[#8bb0d6]">
                            {option.summary}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {!props.useEdgeTts && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">本机可用 voice</p>
                  <select
                    value={props.selectedVoiceURI}
                    onChange={(event) => props.setSelectedVoiceURI(event.target.value)}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-[#0d1d31] px-3 py-3 text-sm text-[#f8f1e4] outline-none"
                    disabled={props.useEdgeTts}
                  >
                    <option value="">自动选择最合适的中文语音</option>
                    {props.voices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} · {voice.lang}{voice.source === 'macos-say' ? ' · Desktop' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-3 text-xs leading-6 text-[#c5b79f]">
                    {props.useEdgeTts
                      ? 'EdgeTTS 作为主方案时，这里只保留兜底用的系统 voice。'
                      : '桌面端会优先枚举 macOS 系统 `say` 语音；没有时再退回浏览器 voice 列表。'}
                  </p>
                  {props.autoPreferredLocalVoice && (
                    <p className="mt-2 text-[11px] leading-5 text-[#9fb1c7]">
                      当前自动推荐：{props.autoPreferredLocalVoice.name}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-[#d9ccb6]">
              <div className="flex flex-wrap gap-4">
                <span>岗位：{props.config?.position ?? '后端开发'}</span>
                <span>语言：{props.config?.language ?? 'Python'}</span>
                <span>候选人维度：{props.config?.practice_audience === 'social' ? '社招' : '校招/实习'}</span>
              </div>
            </div>
          </div>

          <ResumeMountPanel
            title="Resume Mount"
            description="这场模拟面试会直接使用当前挂载简历来生成项目深挖和追问。"
            statusLabel={props.config?.has_resume ? '已同步' : '建议挂载'}
            emptyHint="当前没有挂载简历，系统会按岗位常见能力默认出题。"
            sharedNote="这里和主流程、简历优化共用同一份简历历史与当前挂载记录。"
            historyMode="popover"
            variant="dark"
            className="mt-6"
          />

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={props.handleGenerate}
              disabled={props.loading}
              className="inline-flex items-center gap-2 rounded-full bg-[#f4b88a] px-5 py-2.5 text-sm font-semibold text-[#10233a] transition hover:translate-y-[-1px] hover:bg-[#f6c298] disabled:opacity-50"
            >
              {props.isPreparingView ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在搭建面试现场...
                </>
              ) : (
                <>
                  <Waves className="h-4 w-4" />
                  开始真实模拟面试
                </>
              )}
            </button>
            {!props.config?.has_resume && (
              <div className="rounded-full border border-[#f4b88a]/25 bg-[#f4b88a]/10 px-3 py-2 text-xs text-[#f6dcc0]">
                建议先挂载简历，这样项目深挖会更像真正的一面。
              </div>
            )}
          </div>
          {props.error && <p className="mt-4 text-sm text-[#ffcabd]">{props.error}</p>}
        </section>
      </div>
    </div>
  )
}
