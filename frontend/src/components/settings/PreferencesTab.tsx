import { useState, useEffect } from 'react'
import {
  AlertTriangle,
  Save,
  Palette,
  LayoutGrid,
  AlignVerticalSpaceAround,
  Monitor,
  PenLine,
  ChevronDown,
  BookOpen,
  Keyboard,
} from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { useShortcutsStore } from '@/stores/shortcutsStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { api } from '@/lib/api'
import { updateConfigAndRefresh } from '@/lib/configSync'
import { COLOR_SCHEME_OPTIONS } from '@/lib/colorScheme'
import { forceExamOverlayPrompt } from '@/lib/examOverlay'
import { getShortcutDisplay } from '@/lib/shortcuts'
import { Section, Field, matchSettingsSearch, useSettingsSearch } from './shared'
import NetworkQRCode from './NetworkQRCode'
import QuickPromptsEditor from './QuickPromptsEditor'
import GlobalShortcutsEditor from './GlobalShortcutsEditor'
import BetaBadge from '@/components/kb/BetaBadge'

function Collapsible({ title, searchTitle, icon, defaultOpen = false, badge, keywords, children }: {
  title: React.ReactNode
  searchTitle?: string
  icon?: React.ReactNode
  defaultOpen?: boolean
  badge?: React.ReactNode
  keywords?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const query = useSettingsSearch()
  const titleText = searchTitle ?? (typeof title === 'string' ? title : '')
  if (!matchSettingsSearch(titleText, keywords, query)) return null
  const effectiveOpen = query.trim() ? true : open
  return (
    <section className="rounded-xl border border-bg-hover/60 bg-bg-primary/35 overflow-hidden" data-search-title={titleText}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-bg-tertiary/25 transition-colors"
      >
        {icon && <span className="text-text-muted flex-shrink-0">{icon}</span>}
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        {badge && <span className="flex-shrink-0">{badge}</span>}
        <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${effectiveOpen ? 'rotate-180' : ''}`} />
      </button>
      {effectiveOpen && <div className="px-4 pb-4 space-y-3 border-t border-bg-hover/50">{children}</div>}
    </section>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded bg-bg-tertiary border-bg-hover text-accent-blue focus:ring-accent-blue focus:ring-offset-0"
      />
      <span className="text-xs text-text-secondary">{label}</span>
    </label>
  )
}

export default function PreferencesTab() {
  const config = useInterviewStore((s) => s.config)
  const options = useInterviewStore((s) => s.options)
  const platformInfo = useInterviewStore((s) => s.platformInfo)
  const sttLoaded = useInterviewStore((s) => s.sttLoaded)
  const sttLoading = useInterviewStore((s) => s.sttLoading)
  const sttActiveProvider = useInterviewStore((s) => s.sttActiveProvider)
  const sttFallbackLoaded = useInterviewStore((s) => s.sttFallbackLoaded)
  const setSettingsDrawerTab = useInterviewStore((s) => s.setSettingsDrawerTab)
  const answerPanelLayout = useUiPrefsStore((s) => s.answerPanelLayout)
  const setAnswerPanelLayout = useUiPrefsStore((s) => s.setAnswerPanelLayout)
  const colorScheme = useUiPrefsStore((s) => s.colorScheme)
  const setColorScheme = useUiPrefsStore((s) => s.setColorScheme)
  const overlayEnabled = useUiPrefsStore((s) => s.interviewOverlayEnabled)
  const overlayOpacity = useUiPrefsStore((s) => s.interviewOverlayOpacity)
  const overlayFontSize = useUiPrefsStore((s) => s.interviewOverlayFontSize)
  const overlayFontColor = useUiPrefsStore((s) => s.interviewOverlayFontColor)
  const overlayMode = useUiPrefsStore((s) => s.interviewOverlayMode)
  const overlayFocusWidthPct = useUiPrefsStore((s) => s.interviewOverlayFocusWidthPct)
  const overlayFocusHeightPct = useUiPrefsStore((s) => s.interviewOverlayFocusHeightPct)
  const overlayMaxLines = useUiPrefsStore((s) => s.interviewOverlayMaxLines)
  const setOverlayEnabled = useUiPrefsStore((s) => s.setInterviewOverlayEnabled)
  const setOverlayOpacity = useUiPrefsStore((s) => s.setInterviewOverlayOpacity)
  const setOverlayFontSize = useUiPrefsStore((s) => s.setInterviewOverlayFontSize)
  const setOverlayFontColor = useUiPrefsStore((s) => s.setInterviewOverlayFontColor)
  const setOverlayMode = useUiPrefsStore((s) => s.setInterviewOverlayMode)
  const setOverlayFocusWidthPct = useUiPrefsStore((s) => s.setInterviewOverlayFocusWidthPct)
  const setOverlayFocusHeightPct = useUiPrefsStore((s) => s.setInterviewOverlayFocusHeightPct)
  const setOverlayMaxLines = useUiPrefsStore((s) => s.setInterviewOverlayMaxLines)
  const shortcuts = useShortcutsStore((s) => s.shortcuts)

  const [scrollBottomPx, setScrollBottomPx] = useState(40)
  const [generalSaving, setGeneralSaving] = useState(false)
  const [practiceAudience, setPracticeAudience] = useState('campus_intern')

  useEffect(() => {
    if (config?.answer_autoscroll_bottom_px != null) {
      setScrollBottomPx(config.answer_autoscroll_bottom_px)
    }
    if (config?.practice_audience) {
      setPracticeAudience(config.practice_audience)
    }
  }, [config?.answer_autoscroll_bottom_px, config?.practice_audience])

  const handleSaveGeneral = async () => {
    setGeneralSaving(true)
    try {
      const v = Math.max(4, Math.min(400, scrollBottomPx || 40))
      setScrollBottomPx(v)
      await updateConfigAndRefresh({ answer_autoscroll_bottom_px: v, practice_audience: practiceAudience })
      useInterviewStore.getState().setToastMessage('设置已保存')
    } catch (e: unknown) {
      useInterviewStore.getState().setToastMessage(e instanceof Error ? e.message : '保存失败')
    } finally {
      setGeneralSaving(false)
    }
  }

  const sttLabel =
    config?.stt_provider === 'doubao'
      ? '豆包'
      : config?.stt_provider === 'generic'
        ? '通用 ASR'
        : config?.stt_provider === 'whisper'
          ? 'Whisper'
          : `不支持 (${config?.stt_provider ?? 'unknown'})`
  const hasScreenCapture = (options?.screen_capture_regions?.length ?? 0) > 0
  const searchQuery = useSettingsSearch()
  const inSearch = searchQuery.trim().length > 0

  return (
    <div className="p-5 space-y-5 pb-8" data-in-search={inSearch ? '1' : undefined}>
      {/* ── 系统状态 ── */}
      {platformInfo?.needs_virtual_device && (
        <div className="bg-accent-amber/10 border border-accent-amber/30 rounded-lg p-3 text-xs space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-accent-amber flex-shrink-0 mt-0.5" />
            <div className="text-text-secondary whitespace-pre-line">{platformInfo.instructions}</div>
          </div>
        </div>
      )}

      <Section title="运行状态" icon={<AlertTriangle className="w-3.5 h-3.5" />} keywords="status 状态 stt 语音识别 就绪">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="rounded-xl border border-bg-hover/60 bg-bg-tertiary/25 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${sttLoaded ? (sttActiveProvider === 'whisper' ? 'bg-accent-amber' : 'bg-accent-green') : sttLoading ? 'bg-accent-amber animate-pulse' : 'bg-accent-red'}`} />
              <span className="text-xs font-medium text-text-primary">语音识别</span>
            </div>
            <p className="text-[11px] text-text-muted mt-1">
              {sttLoaded ? (sttActiveProvider === 'whisper' ? 'Whisper 降级就绪' : sttFallbackLoaded ? '就绪，降级已预备' : '就绪') : sttLoading ? '加载中' : '未就绪'} · {sttLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsDrawerTab('config')}
            className="rounded-xl border border-accent-blue/30 bg-accent-blue/10 px-3 py-2.5 text-left hover:bg-accent-blue/15 transition-colors"
          >
            <span className="text-xs font-medium text-accent-blue">语音配置</span>
            <p className="text-[11px] text-text-muted mt-1">切换 STT / TTS 与断句参数</p>
          </button>
        </div>
      </Section>

      <Section title="回答体验" icon={<LayoutGrid className="w-3.5 h-3.5" />} keywords="布局 卡片 流式 简短 layout card stream">
        <div className="grid grid-cols-2 gap-2">
          {([
            { key: 'cards' as const, icon: LayoutGrid, label: '卡片', hint: '独立框，框内滚动' },
            { key: 'stream' as const, icon: AlignVerticalSpaceAround, label: '流式', hint: '通读，无高度限制' },
          ]).map(({ key, icon: Icon, label, hint }) => (
            <button
              key={key}
              type="button"
              onClick={() => setAnswerPanelLayout(key)}
              className={`flex flex-col items-start gap-1.5 p-2.5 rounded-xl border text-left transition-all ${
                answerPanelLayout === key
                  ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/30'
                  : 'border-bg-hover bg-bg-tertiary/30 hover:border-bg-hover'
              }`}
            >
              <Icon className={`w-4 h-4 ${answerPanelLayout === key ? 'text-accent-blue' : 'text-text-muted'}`} />
              <span className="text-xs font-medium text-text-primary">{label}</span>
              <span className="text-[10px] text-text-muted leading-snug">{hint}</span>
            </button>
          ))}
        </div>
        <Field label="回答长度">
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: false, label: '详细回答', hint: '解释更完整' },
              { value: true, label: '简短回答', hint: '更快跟住问题' },
            ]).map((item) => {
              const selected = (config?.assist_high_churn_short_answer ?? false) === item.value
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={async () => {
                    try {
                      await updateConfigAndRefresh({ assist_high_churn_short_answer: item.value })
                    } catch {}
                  }}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                    selected
                      ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/30'
                      : 'border-bg-hover bg-bg-tertiary/25 hover:border-bg-hover'
                  }`}
                >
                  <span className={`text-xs font-semibold ${selected ? 'text-accent-blue' : 'text-text-primary'}`}>
                    {item.label}
                  </span>
                  <span className="block text-[10px] text-text-muted mt-1">{item.hint}</span>
                </button>
              )
            })}
          </div>
          <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
            当前：{config?.assist_high_churn_short_answer ? '简短回答' : '详细回答'}
          </p>
        </Field>
        <Field label="候选人维度" hint="影响练习模式的出题与点评风格">
          <select value={practiceAudience}
            onChange={(e) => setPracticeAudience(e.target.value)}
            className="input-field">
            {(options?.practice_audiences ?? ['campus_intern', 'social']).map((v) => (
              <option key={v} value={v}>{v === 'social' ? '社招' : '校招（实习）'}</option>
            ))}
          </select>
        </Field>
      </Section>

      {/* ── 2. 悬浮提示窗（含截图区域、笔试模式） ── */}
      <Collapsible
        title={
          <span className="inline-flex items-center gap-1.5">
            工作模式
            <BetaBadge title="悬浮提示窗 — 仍在测试中" />
          </span>
        }
        searchTitle="工作模式"
        icon={<Monitor className="w-3.5 h-3.5" />}
        keywords="overlay 截图 笔试 toolbar ocr vision 悬浮窗 浮窗 beta exam"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setOverlayEnabled(!overlayEnabled)}
            className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
              overlayEnabled ? 'border-accent-blue bg-accent-blue/10' : 'border-bg-hover bg-bg-tertiary/25 hover:border-bg-hover'
            }`}
          >
            <span className="text-xs font-medium text-text-primary">悬浮提示窗</span>
            <p className="text-[10px] text-text-muted mt-1">{overlayEnabled ? '已开启' : '已关闭'}</p>
          </button>
          {config && hasScreenCapture && (
            <button
              type="button"
              onClick={() => {
                const next = !(config?.written_exam_mode ?? false)
                updateConfigAndRefresh({ written_exam_mode: next })
                  .then(() => {
                    if (next) forceExamOverlayPrompt()
                  })
                  .catch(() => {})
              }}
              className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                config?.written_exam_mode ? 'border-accent-blue bg-accent-blue/10' : 'border-bg-hover bg-bg-tertiary/25 hover:border-bg-hover'
              }`}
            >
              <span className="text-xs font-medium text-text-primary">笔试模式</span>
              <p className="text-[10px] text-text-muted mt-1">{config?.written_exam_mode ? '已开启' : '已关闭'}</p>
            </button>
          )}
        </div>
        <div className="mb-2 p-2.5 rounded-lg bg-accent-amber/10 border border-accent-amber/30 text-[11px] text-text-secondary leading-relaxed">
          <div className="font-semibold text-accent-amber mb-0.5">反截图检测为 Beta 能力</div>
          <div>
            Windows 上通过 <code className="font-mono text-[10px] bg-bg-tertiary/60 px-1 rounded">setContentProtection</code> 可稳定避免被屏幕共享软件截图；
            macOS 15+ 的 <span className="font-mono text-[10px]">ScreenCaptureKit</span> 会绕过保护位，实际效果请以你自己的环境测试为准。
          </div>
        </div>
        {overlayEnabled && (
          <>
            <Field label="显示模式">
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: 'glass' as const, label: '磨砂面板', hint: '半透明深色背景' },
                  { key: 'prompt' as const, label: '提词模式', hint: '纯文字不带框' },
                  { key: 'focus' as const, label: '专注面板', hint: '浅色解题面板' },
                ]).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setOverlayMode(item.key)}
                    className={`px-3 py-2 text-xs rounded-lg border text-left transition-all ${
                      overlayMode === item.key
                        ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                        : 'border-bg-hover bg-bg-tertiary/30 text-text-secondary hover:border-bg-hover'
                    }`}
                  >
                    <span className="block font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-[10px] text-text-muted leading-snug">{item.hint}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-text-muted mt-1 leading-relaxed">
                {overlayMode === 'focus'
                  ? '浅色半透明大面板，复用悬浮窗防捕获与不抢焦点能力'
                  : overlayMode === 'glass'
                    ? '半透明磨砂玻璃背景，适合暗色桌面'
                    : '无框纯文字、隐藏多余信息，仅保留答案'}
              </p>
            </Field>
            <Field label={`不透明度: ${Math.round(overlayOpacity * 100)}%`}>
              <input type="range" min={10} max={100} value={Math.round(overlayOpacity * 100)}
                onChange={(e) => setOverlayOpacity(Number(e.target.value) / 100)} className="w-full max-w-[200px]" />
            </Field>
            {overlayMode === 'focus' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={`专注面板宽度: ${overlayFocusWidthPct}%`}>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    value={overlayFocusWidthPct}
                    onChange={(e) => setOverlayFocusWidthPct(Number(e.target.value))}
                    className="w-full max-w-[200px]"
                  />
                </Field>
                <Field label={`专注面板高度: ${overlayFocusHeightPct}%`}>
                  <input
                    type="range"
                    min={35}
                    max={100}
                    value={overlayFocusHeightPct}
                    onChange={(e) => setOverlayFocusHeightPct(Number(e.target.value))}
                    className="w-full max-w-[200px]"
                  />
                </Field>
              </div>
            )}
            <Field label={`字号: ${overlayFontSize}px`}>
              <input type="range" min={10} max={48} value={overlayFontSize}
                onChange={(e) => setOverlayFontSize(Number(e.target.value))} className="w-full max-w-[200px]" />
            </Field>
            <div className="flex items-center gap-4">
              <Field label="字体颜色">
                <div className="flex items-center gap-1.5">
                  <input type="color" value={overlayFontColor}
                    onChange={(e) => setOverlayFontColor(e.target.value)}
                    className="w-6 h-6 rounded border border-bg-hover cursor-pointer bg-transparent p-0" />
                  <span className="text-[10px] text-text-muted font-mono">{overlayFontColor}</span>
                </div>
              </Field>
              <Field label={`最大行数: ${overlayMaxLines > 0 ? overlayMaxLines : '不限'}`}>
                <input type="range" min={0} max={50} value={overlayMaxLines}
                  onChange={(e) => setOverlayMaxLines(Number(e.target.value))} className="w-24" />
              </Field>
            </div>
            <p className="text-[10px] text-text-muted leading-relaxed -mt-1">
              悬浮窗不会抢占焦点,直接用鼠标滚轮即可滚动内容,
              <kbd className="px-1 py-0.5 bg-bg-hover rounded text-[9px]">{getShortcutDisplay(shortcuts.moveOverlayToMouse?.key ?? 'CommandOrControl+M')}</kbd> 可把窗口一键移到鼠标附近。
              专注面板打开时,
              <kbd className="px-1 py-0.5 bg-bg-hover rounded text-[9px]">{getShortcutDisplay(shortcuts.focusPrevTab?.key ?? 'CommandOrControl+Left')}</kbd>
              /
              <kbd className="px-1 py-0.5 bg-bg-hover rounded text-[9px]">{getShortcutDisplay(shortcuts.focusNextTab?.key ?? 'CommandOrControl+Right')}</kbd>
              切换分区。
              悬浮窗打开时,
              <kbd className="px-1 py-0.5 bg-bg-hover rounded text-[9px]">{getShortcutDisplay(shortcuts.overlayPrevQuestion?.key ?? 'CommandOrControl+Up')}</kbd>
              /
              <kbd className="px-1 py-0.5 bg-bg-hover rounded text-[9px]">{getShortcutDisplay(shortcuts.overlayNextQuestion?.key ?? 'CommandOrControl+Down')}</kbd>
              回看上一题/下一题, 不影响当前生成。
            </p>
          </>
        )}

        {/* 截图区域 */}
        {config && hasScreenCapture && (
          <Field label="截图区域" hint="服务端截图审题时，后端截取主显示器的范围">
            <select
              value={config.screen_capture_region ?? 'left_half'}
              onChange={async (e) => {
                try {
                  await updateConfigAndRefresh({ screen_capture_region: e.target.value })
                } catch {}
              }}
              className="input-field w-full max-w-[200px]"
            >
              {(options?.screen_capture_regions ?? []).map((r) => (
                <option key={r} value={r}>
                  {r === 'full' ? '全屏' : r === 'left_half' ? '左半屏' : r === 'right_half' ? '右半屏' : r === 'top_half' ? '上半屏' : '下半屏'}
                </option>
              ))}
            </select>
          </Field>
        )}

        {config && hasScreenCapture && (
          <Field
            label={`多图截图等待: ${config.multi_screen_capture_idle_sec ?? 10} 秒`}
            hint="多图截图判题快捷键最后一次按下后，等待这段时间无新截图就提交整批图片 (1-60)"
          >
            <input
              type="number"
              min={1}
              max={60}
              step={1}
              value={config.multi_screen_capture_idle_sec ?? 10}
              onChange={(e) => {
                const v = Math.max(1, Math.min(60, Number(e.target.value) || 10))
                updateConfigAndRefresh({ multi_screen_capture_idle_sec: v }).catch(() => {})
              }}
              className="input-field w-full max-w-[120px]"
            />
          </Field>
        )}

        {/* 笔试模式 */}
        {config && hasScreenCapture && (
          <div className="border-t border-bg-hover/40 pt-3 space-y-3">
            <div className="flex items-center gap-2">
              <PenLine className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">笔试模式</span>
              <BetaBadge title="笔试模式 — 仍在测试中" />
            </div>
            <Toggle
              checked={config?.written_exam_mode ?? false}
              onChange={async (v) => {
                try {
                  await updateConfigAndRefresh({ written_exam_mode: v })
                  if (v) forceExamOverlayPrompt()
                } catch {}
              }}
              label={config?.written_exam_mode ? '已开启' : '已关闭'}
            />
            {config?.written_exam_mode && (
              <>
                <Field label="深度思考 (Think)">
                  <Toggle
                    checked={config?.written_exam_think ?? false}
                    onChange={async (v) => {
                      try {
                        await updateConfigAndRefresh({ written_exam_think: v })
                      } catch {}
                    }}
                    label={config?.written_exam_think ? '已开启（更准但更慢）' : '已关闭（更快）'}
                  />
                  <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                    开启后模型会先推理再作答，编程题准确率更高，但响应变慢。需模型支持 think。
                  </p>
                </Field>
                <div className="bg-accent-blue/5 border border-accent-blue/20 rounded-lg p-2.5 space-y-1">
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    <span className="font-medium text-accent-blue">配合截图快捷键使用</span>
                  </p>
                  <ul className="text-[10px] text-text-muted leading-relaxed space-y-0.5 pl-3 list-disc">
                    <li>选择题 → 直接输出答案（如 A.Redis）</li>
                    <li>编程题 → 直接输出完整可提交代码</li>
                    <li>填空题 → 直接输出填空内容</li>
                  </ul>
                </div>
              </>
            )}
          </div>
        )}
      </Collapsible>

      {/* ── 3. 知识库 (Beta) ── */}
      <Collapsible
        title="知识库与引用"
        icon={<BookOpen className="w-3.5 h-3.5" />}
        keywords="kb knowledge base 笔记 参考 rag retrieval 引用"
        badge={<BetaBadge title="知识库 — 仍在测试中" className="ml-1" />}
      >
        <Field
          label="主流程引用本地笔记"
          hint="开启后 LLM 会在回答前从本地知识库检索相关内容并以 [角标] 引用; 关闭仅 Drawer 内手动测试可用"
        >
          <Toggle
            checked={config?.kb_enabled ?? false}
            onChange={async (v) => {
              try {
                await updateConfigAndRefresh({ kb_enabled: v })
                useInterviewStore.getState().setToastMessage(v ? '已开启知识库' : '已关闭知识库')
              } catch (e) {
                useInterviewStore.getState().setToastMessage(e instanceof Error ? e.message : '保存失败')
              }
            }}
            label={config?.kb_enabled ? '已开启' : '已关闭'}
          />
        </Field>
        <Field
          label={`命中数 top_k: ${config?.kb_top_k ?? 4}`}
          hint="一次检索最多返回的笔记片段数 (1-20)"
        >
          <input
            type="number"
            min={1}
            max={20}
            value={config?.kb_top_k ?? 4}
            onChange={(e) => {
              const v = Math.max(1, Math.min(20, Number(e.target.value) || 4))
              updateConfigAndRefresh({ kb_top_k: v }).catch(() => {})
            }}
            className="w-full max-w-[120px] bg-bg-tertiary border border-bg-hover rounded-lg px-3 py-2 text-sm text-text-primary"
          />
        </Field>
        <Field
          label={`手动模式 deadline: ${config?.kb_deadline_ms ?? 150} ms`}
          hint="手动输入 / 截图模式下检索的硬上限; 超时不阻塞首字, 直接返回空 (20-2000)"
        >
          <input
            type="number"
            min={20}
            max={2000}
            step={10}
            value={config?.kb_deadline_ms ?? 150}
            onChange={(e) => {
              const v = Math.max(20, Math.min(2000, Number(e.target.value) || 150))
              updateConfigAndRefresh({ kb_deadline_ms: v }).catch(() => {})
            }}
            className="w-full max-w-[120px] bg-bg-tertiary border border-bg-hover rounded-lg px-3 py-2 text-sm text-text-primary"
          />
        </Field>
        <Field
          label={`ASR 模式 deadline: ${config?.kb_asr_deadline_ms ?? 80} ms`}
          hint="实时语音模式下更紧的检索上限, 优先保证首字延迟 (20-1000)"
        >
          <input
            type="number"
            min={20}
            max={1000}
            step={10}
            value={config?.kb_asr_deadline_ms ?? 80}
            onChange={(e) => {
              const v = Math.max(20, Math.min(1000, Number(e.target.value) || 80))
              updateConfigAndRefresh({ kb_asr_deadline_ms: v }).catch(() => {})
            }}
            className="w-full max-w-[120px] bg-bg-tertiary border border-bg-hover rounded-lg px-3 py-2 text-sm text-text-primary"
          />
        </Field>
        <p className="text-[10px] text-text-muted leading-relaxed">
          点击右上角 📖 图标管理文档/手动检索测试; OCR、Vision 等高阶配置仍在 backend/config.json 中。
        </p>
      </Collapsible>

      {/* ── 4. 外观与高级 ── */}
      <Collapsible title="外观" icon={<Palette className="w-3.5 h-3.5" />} keywords="主题 配色 字体 theme color scheme font 高级">
        <Field label="配色方案">
          <div className="grid grid-cols-1 gap-1.5">
            {COLOR_SCHEME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setColorScheme(opt.id)
                  useInterviewStore.getState().setToastMessage(`已切换为 ${opt.label}`)
                }}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left transition-all ${
                  colorScheme === opt.id
                    ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/30'
                    : 'border-bg-hover bg-bg-tertiary/30 hover:border-bg-hover'
                }`}
              >
                <Palette className="w-3 h-3 text-accent-blue flex-shrink-0" />
                <span className="text-xs font-medium text-text-primary">{opt.label}</span>
                <span className="text-[10px] text-text-muted ml-auto">{opt.hint}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="流式跟滚阈值（像素）" hint="距底部小于该值时自动滚到底（4～400）">
          <input
            type="number" min={4} max={400} value={scrollBottomPx}
            onChange={(e) => setScrollBottomPx(Number(e.target.value) || 40)}
            onBlur={async () => {
              const v = Math.max(4, Math.min(400, scrollBottomPx || 40))
              setScrollBottomPx(v)
              try {
                await updateConfigAndRefresh({ answer_autoscroll_bottom_px: v })
              } catch {}
            }}
            className="w-full max-w-[120px] bg-bg-tertiary border border-bg-hover rounded-lg px-3 py-2 text-sm text-text-primary"
          />
        </Field>
      </Collapsible>

      <Collapsible title="快捷操作" icon={<Keyboard className="w-3.5 h-3.5" />} keywords="quick prompt 快捷词 模板 shortcut 快捷键 手机 二维码">
        <NetworkQRCode />
        <QuickPromptsEditor />
        <GlobalShortcutsEditor />
      </Collapsible>

      <button
        type="button"
        onClick={handleSaveGeneral}
        disabled={generalSaving}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {generalSaving ? '保存中…' : '保存设置'}
      </button>

    </div>
  )
}
