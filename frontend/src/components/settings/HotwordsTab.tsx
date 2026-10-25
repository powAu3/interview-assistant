import { useEffect, useState } from 'react'
import { AudioWaveform } from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { updateConfigAndRefresh } from '@/lib/configSync'
import {
  Field,
  GradientCard,
  InfoHint,
  SaveStateBadge,
  Section,
  useAutoSaveSetting,
} from './shared'

/** 岗位热词：独立分区，改动自动保存（无需点保存按钮）。 */
export default function HotwordsTab() {
  const config = useInterviewStore((s) => s.config)
  const options = useInterviewStore((s) => s.options)
  const [position, setPosition] = useState('通用')
  const [hotwords, setHotwords] = useState<Record<string, string>>(() => ({ ...(config?.stt_hotwords ?? {}) }))

  const autoSave = useAutoSaveSetting<{ hotwords: Record<string, string> }>(
    async (data) => updateConfigAndRefresh({ stt_hotwords: data.hotwords }),
    600,
  )

  // 非保存期间跟随服务端配置（保存动作本身会刷新 config）
  useEffect(() => {
    // saving（含防抖窗口）与 error（保留用户未保存内容等待重试）期间不回灌
    if (autoSave.state === 'saving' || autoSave.state === 'error') return
    setHotwords({ ...(config?.stt_hotwords ?? {}) })
  }, [config?.stt_hotwords, autoSave.state])

  const positions = ['通用', ...(options?.positions ?? [])]
  const updateWords = (key: string, value: string) => {
    const next = { ...hotwords }
    if (value.trim()) next[key] = value
    else delete next[key]
    setHotwords(next)
    autoSave.saveDebounced({ hotwords: next })
  }
  const configured = Object.entries(hotwords).filter(([, v]) => (v ?? '').trim())

  return (
    <div className="p-5 space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bg-hover/60 bg-bg-primary/35 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">岗位热词</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
            按岗位维护本地 ASR 术语偏置，改动自动保存。
          </p>
        </div>
        <SaveStateBadge mode="auto" state={autoSave.state} error={autoSave.error} />
      </div>

      <Section
        title="热词配置"
        icon={<AudioWaveform className="w-3.5 h-3.5" />}
        keywords="hotwords 热词 岗位 position 自定义 词汇 偏置 funasr whisper rag 术语"
      >
        <GradientCard className="p-4 space-y-3">
          <p className="text-[11px] leading-relaxed text-text-secondary inline-flex items-center gap-1">
            内置 AI 术语词库自动生效，此处按岗位追加专属词
            <InfoHint text="RAG / LLM / Agent / Embedding / 向量数据库 / 微调 / LoRA / MCP 等通用术语已内置词库，无需重复填写；此处建议填公司/项目专属词（如 rules、skills、内部系统名）。FunASR（paraformer）的热词直接参与解码偏置，效果最强；Whisper 作为提示偏置。热词超长时会按优先级截断，重要的词放前面。" />
          </p>
          <div className="grid gap-3 md:grid-cols-[200px_1fr]">
            <Field label="岗位">
              <select
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                className="input-field"
                aria-label="选择热词岗位"
              >
                {positions.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos === '通用' ? '通用（所有岗位生效）' : pos}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`${position} · 自定义热词`} hint="空格/逗号分隔；清空即删除该岗位配置">
              <textarea
                aria-label={`${position} 自定义热词`}
                value={hotwords[position] ?? ''}
                onChange={(e) => updateWords(position, e.target.value)}
                placeholder="如：RAG LangGraph Milvus rules skills（内置词库已含常见 AI 术语，填专属词更有效）"
                rows={4}
                className="input-field min-h-[80px] resize-y"
              />
            </Field>
          </div>
          {configured.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
              <span>已配置：</span>
              {configured.map(([k, v]) => (
                <span key={k} className="px-1.5 py-0.5 rounded-md bg-bg-tertiary/70 border border-bg-hover/60" title={v}>
                  {k}
                </span>
              ))}
            </div>
          )}
        </GradientCard>
      </Section>
    </div>
  )
}
