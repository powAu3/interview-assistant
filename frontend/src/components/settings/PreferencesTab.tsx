import { useState, useEffect } from 'react'
import {
  AlertTriangle,
  Save,
  Palette,
  LayoutGrid,
  AlignVerticalSpaceAround,
  Captions,
  MessageSquareQuote,
} from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { api } from '@/lib/api'
import { COLOR_SCHEME_OPTIONS } from '@/lib/colorScheme'
import { Section, Field } from './shared'
import NetworkQRCode from './NetworkQRCode'
import QuickPromptsEditor from './QuickPromptsEditor'
import GlobalShortcutsEditor from './GlobalShortcutsEditor'

export default function PreferencesTab() {
  const {
    config,
    options,
    platformInfo,
    sttLoaded,
    sttLoading,
    answerPanelLayout,
    setAnswerPanelLayout,
    colorScheme,
    setColorScheme,
    interviewOverlayEnabled,
    interviewOverlayMode,
    interviewOverlayOpacity,
    interviewOverlayLyricLines,
    interviewOverlayLyricFontSize,
    interviewOverlayLyricWidth,
    setInterviewOverlayEnabled,
    setInterviewOverlayMode,
    setInterviewOverlayOpacity,
    setInterviewOverlayLyricLines,
    setInterviewOverlayLyricFontSize,
    setInterviewOverlayLyricWidth,
    setSettingsDrawerTab,
  } = useInterviewStore()

  const [scrollBottomPx, setScrollBottomPx] = useState(40)
  const [generalSaving, setGeneralSaving] = useState(false)
  const [practiceAudience, setPracticeAudience] = useState('campus_intern')
  const [overlayEnabled, setOverlayEnabled] = useState(false)
  const [overlayMode, setOverlayMode] = useState<'panel' | 'lyrics'>('panel')
  const [overlayOpacity, setOverlayOpacityLocal] = useState(0.82)
  const [overlayLyricLines, setOverlayLyricLinesLocal] = useState(2)
  const [overlayLyricFontSize, setOverlayLyricFontSizeLocal] = useState(23)
  const [overlayLyricWidth, setOverlayLyricWidthLocal] = useState(760)

  useEffect(() => {
    if (config?.answer_autoscroll_bottom_px != null) {
      setScrollBottomPx(config.answer_autoscroll_bottom_px)
    }
    if (config?.practice_audience) {
      setPracticeAudience(config.practice_audience)
    }
    setOverlayEnabled(interviewOverlayEnabled)
    setOverlayMode(interviewOverlayMode)
    setOverlayOpacityLocal(interviewOverlayOpacity)
    setOverlayLyricLinesLocal(interviewOverlayLyricLines)
    setOverlayLyricFontSizeLocal(interviewOverlayLyricFontSize)
    setOverlayLyricWidthLocal(interviewOverlayLyricWidth)
  }, [
    config?.answer_autoscroll_bottom_px,
    config?.practice_audience,
    interviewOverlayEnabled,
    interviewOverlayLyricLines,
    interviewOverlayLyricFontSize,
    interviewOverlayLyricWidth,
    interviewOverlayMode,
    interviewOverlayOpacity,
  ])

  const handleSaveGeneral = async () => {
    setGeneralSaving(true)
    try {
      const v = Math.max(4, Math.min(400, scrollBottomPx || 40))
      setScrollBottomPx(v)
      await api.updateConfig({ answer_autoscroll_bottom_px: v, practice_audience: practiceAudience })
      useInterviewStore.getState().setConfig(await api.getConfig())
      setInterviewOverlayEnabled(overlayEnabled)
      setInterviewOverlayMode(overlayMode)
      setInterviewOverlayOpacity(overlayOpacity)
      setInterviewOverlayLyricLines(overlayLyricLines)
      setInterviewOverlayLyricFontSize(overlayLyricFontSize)
      setInterviewOverlayLyricWidth(overlayLyricWidth)
      useInterviewStore.getState().setToastMessage('设置已保存')
    } catch (e: unknown) {
      useInterviewStore.getState().setToastMessage(e instanceof Error ? e.message : '保存失败')
    } finally {
      setGeneralSaving(false)
    }
  }

  const sttLabel = config?.stt_provider === 'doubao' ? '豆包' : config?.stt_provider === 'iflytek' ? '讯飞' : 'Whisper'

  return (
    <div className="p-5 space-y-5 pb-8">
      {platformInfo?.needs_virtual_device && (
        <div className="bg-accent-amber/10 border border-accent-amber/30 rounded-lg p-3 text-xs space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-accent-amber flex-shrink-0 mt-0.5" />
            <div className="text-text-secondary whitespace-pre-line">{platformInfo.instructions}</div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs px-1">
        <div className={`w-2 h-2 rounded-full ${sttLoaded ? 'bg-accent-green' : sttLoading ? 'bg-accent-amber animate-pulse' : 'bg-accent-red'}`} />
        <span className="text-text-secondary">
          语音识别: {sttLoaded ? '就绪' : sttLoading ? '加载中…' : '未就绪'}（{sttLabel}）
        </span>
      </div>

      <Section title="配色方案" icon={<Palette className="w-3.5 h-3.5" />}>
        <p className="text-[11px] text-text-muted -mt-1 leading-relaxed">
          参考 VS Code 主题，仅切换背景、文字与代码高亮。
        </p>
        <div className="grid grid-cols-1 gap-2">
          {COLOR_SCHEME_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setColorScheme(opt.id)
                useInterviewStore.getState().setToastMessage(`已切换为 ${opt.label}`)
              }}
              className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-all ${
                colorScheme === opt.id
                  ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/30'
                  : 'border-bg-hover bg-bg-tertiary/30 hover:border-bg-hover'
              }`}
            >
              <span className="text-sm font-medium text-text-primary flex items-center gap-2">
                <Palette className="w-3.5 h-3.5 text-accent-blue flex-shrink-0" />
                {opt.label}
              </span>
              <span className="text-[10px] text-text-muted leading-snug pl-6">{opt.hint}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="答案展示方式">
        <p className="text-[11px] text-text-muted -mt-1">多路模型同时生成时，流式模式下各路答案自上而下依次排开。</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setAnswerPanelLayout('cards')}
            className={`flex flex-col items-start gap-2 p-3 rounded-xl border text-left transition-all ${
              answerPanelLayout === 'cards'
                ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/30'
                : 'border-bg-hover bg-bg-tertiary/30 hover:border-bg-hover'
            }`}
          >
            <LayoutGrid className={`w-5 h-5 ${answerPanelLayout === 'cards' ? 'text-accent-blue' : 'text-text-muted'}`} />
            <span className="text-sm font-medium text-text-primary">卡片</span>
            <span className="text-[10px] text-text-muted leading-snug">每题答案独立框，框内滚动</span>
          </button>
          <button
            type="button"
            onClick={() => setAnswerPanelLayout('stream')}
            className={`flex flex-col items-start gap-2 p-3 rounded-xl border text-left transition-all ${
              answerPanelLayout === 'stream'
                ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/30'
                : 'border-bg-hover bg-bg-tertiary/30 hover:border-bg-hover'
            }`}
          >
            <AlignVerticalSpaceAround className={`w-5 h-5 ${answerPanelLayout === 'stream' ? 'text-accent-blue' : 'text-text-muted'}`} />
            <span className="text-sm font-medium text-text-primary">流式</span>
            <span className="text-[10px] text-text-muted leading-snug">自上而下通读，无单框高度限制</span>
          </button>
        </div>
        <div className="mt-3 space-y-1.5">
          <label className="text-xs text-text-secondary">流式跟滚阈值（像素）</label>
          <p className="text-[10px] text-text-muted leading-snug">
            输出流式答案时，若当前已接近底部则自动滚到底；数值越小越容易停在中段（4～400）。
          </p>
          <input
            type="number"
            min={4}
            max={400}
            value={scrollBottomPx}
            onChange={(e) => setScrollBottomPx(Number(e.target.value) || 40)}
            onBlur={async () => {
              const v = Math.max(4, Math.min(400, scrollBottomPx || 40))
              setScrollBottomPx(v)
              try {
                await api.updateConfig({ answer_autoscroll_bottom_px: v })
                useInterviewStore.getState().setConfig(await api.getConfig())
                useInterviewStore.getState().setToastMessage('跟滚阈值已保存')
              } catch (e: unknown) {
                useInterviewStore.getState().setToastMessage(e instanceof Error ? e.message : '保存失败')
              }
            }}
            className="w-full max-w-[120px] bg-bg-tertiary border border-bg-hover rounded-lg px-3 py-2 text-sm text-text-primary"
          />
        </div>
      </Section>

      <Section
        title={
          <span className="flex items-center gap-2">
            面试悬浮提示窗
            <span className="px-1.5 py-0.5 rounded-full border border-accent-amber/30 bg-accent-amber/10 text-[9px] uppercase tracking-[0.14em] text-accent-amber">
              Beta
            </span>
          </span>
        }
      >
        <p className="text-[11px] text-text-muted -mt-1 leading-relaxed">
          仅桌面端生效。开启后，点击「开始面试」会自动弹出一个可拖拽、可调透明度的透明悬浮窗。
        </p>
        <p className="text-[10px] text-text-muted -mt-1">
          已支持位置持久化；也可以通过快捷键一键显示/隐藏悬浮窗。
        </p>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-bg-hover bg-bg-tertiary/30 px-3 py-2.5">
          <div className="space-y-1">
            <div className="text-sm font-medium text-text-primary">启用悬浮提示窗</div>
            <div className="text-[10px] text-text-muted">适合面试过程中只保留核心提示，不想一直看完整主界面时使用。</div>
          </div>
          <input
            type="checkbox"
            checked={overlayEnabled}
            onChange={(e) => setOverlayEnabled(e.target.checked)}
            className="h-4 w-4 accent-accent-blue"
          />
        </label>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setOverlayMode('panel')}
            className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all ${
              overlayMode === 'panel'
                ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/30'
                : 'border-bg-hover bg-bg-tertiary/30 hover:border-bg-hover'
            }`}
          >
            <MessageSquareQuote className={`w-5 h-5 ${overlayMode === 'panel' ? 'text-accent-blue' : 'text-text-muted'}`} />
            <span className="text-sm font-medium text-text-primary">问答框</span>
            <span className="text-[10px] text-text-muted leading-snug">显示最近一条 Ask + Answer，适合单机位、普通会议窗口。</span>
          </button>

          <button
            type="button"
            onClick={() => setOverlayMode('lyrics')}
            className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all ${
              overlayMode === 'lyrics'
                ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/30'
                : 'border-bg-hover bg-bg-tertiary/30 hover:border-bg-hover'
            }`}
          >
            <Captions className={`w-5 h-5 ${overlayMode === 'lyrics' ? 'text-accent-blue' : 'text-text-muted'}`} />
            <span className="text-sm font-medium text-text-primary">歌词条</span>
            <span className="text-[10px] text-text-muted leading-snug">只显示最近回答的滚动短句，默认两行，适合双机位/远距离偷看。</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="透明度" hint="参考 interview-cn 的透明浮窗思路，越低越隐蔽">
            <div className="space-y-2">
              <input
                type="range"
                min={35}
                max={100}
                step={5}
                value={Math.round(overlayOpacity * 100)}
                onChange={(e) => setOverlayOpacityLocal(Number(e.target.value) / 100)}
                className="w-full"
              />
              <div className="text-[11px] text-text-muted">{Math.round(overlayOpacity * 100)}%</div>
            </div>
          </Field>

          <Field label="歌词行数" hint="双机位建议 2 行；最多 4 行">
            <input
              type="number"
              min={1}
              max={4}
              value={overlayLyricLines}
              onChange={(e) => setOverlayLyricLinesLocal(Math.max(1, Math.min(4, Number(e.target.value) || 2)))}
              className="w-full max-w-[120px] bg-bg-tertiary border border-bg-hover rounded-lg px-3 py-2 text-sm text-text-primary"
            />
          </Field>

          <Field label="歌词字号" hint="字号越大越远距离可见">
            <div className="space-y-2">
              <input
                type="range"
                min={16}
                max={40}
                step={1}
                value={overlayLyricFontSize}
                onChange={(e) => setOverlayLyricFontSizeLocal(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-[11px] text-text-muted">{overlayLyricFontSize}px</div>
            </div>
          </Field>

          <Field label="歌词宽度" hint="更宽更适合长句；会同步调整悬浮窗宽度">
            <div className="space-y-2">
              <input
                type="range"
                min={420}
                max={1200}
                step={20}
                value={overlayLyricWidth}
                onChange={(e) => setOverlayLyricWidthLocal(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-[11px] text-text-muted">{overlayLyricWidth}px</div>
            </div>
          </Field>
        </div>
      </Section>

      {config && (options?.screen_capture_regions?.length ?? 0) > 0 && (
        <Section title="电脑截图区域">
          <p className="text-[10px] text-text-muted mb-2 leading-snug">
            手机端「截屏审题」时，服务端截取主显示器的范围。
          </p>
          <select
            value={config.screen_capture_region ?? 'left_half'}
            onChange={async (e) => {
              const v = e.target.value
              try {
                await api.updateConfig({ screen_capture_region: v })
                useInterviewStore.getState().setConfig(await api.getConfig())
                useInterviewStore.getState().setToastMessage('截图区域已保存')
              } catch (err) {
                useInterviewStore.getState().setToastMessage(err instanceof Error ? err.message : '保存失败')
              }
            }}
            className="input-field w-full max-w-[200px]"
          >
            {options!.screen_capture_regions!.map((r) => (
              <option key={r} value={r}>
                {r === 'full' ? '全屏' : r === 'left_half' ? '左半屏' : r === 'right_half' ? '右半屏' : r === 'top_half' ? '上半屏' : '下半屏'}
              </option>
            ))}
          </select>
        </Section>
      )}

      {/* practice_audience moved here from SpeechTab */}
      <Section title="模拟面试维度" icon={<LayoutGrid className="w-3.5 h-3.5" />}>
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

      <NetworkQRCode />
      <QuickPromptsEditor />
      <GlobalShortcutsEditor />

      <button
        type="button"
        onClick={handleSaveGeneral}
        disabled={generalSaving}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {generalSaving ? '保存中…' : '保存设置'}
      </button>

      <button
        type="button"
        onClick={() => setSettingsDrawerTab('config')}
        className="w-full py-2.5 text-xs font-medium rounded-xl border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/10 transition-colors"
      >
        前往「语音识别」配置 STT 引擎
      </button>
    </div>
  )
}
