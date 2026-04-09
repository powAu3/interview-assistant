import { useState, useEffect } from 'react'
import {
  AlertTriangle,
  Save,
  Palette,
  LayoutGrid,
  AlignVerticalSpaceAround,
  Monitor,
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
    setSettingsDrawerTab,
    interviewOverlayEnabled,
    interviewOverlayMode,
    interviewOverlayOpacity,
    interviewOverlayPanelFontSize,
    interviewOverlayPanelWidth,
    interviewOverlayPanelShowBg,
    interviewOverlayLyricLines,
    interviewOverlayLyricFontSize,
    interviewOverlayLyricWidth,
    interviewOverlayLyricColor,
    setInterviewOverlayEnabled,
    setInterviewOverlayMode,
    setInterviewOverlayOpacity,
    setInterviewOverlayPanelFontSize,
    setInterviewOverlayPanelWidth,
    setInterviewOverlayPanelShowBg,
    setInterviewOverlayLyricLines,
    setInterviewOverlayLyricFontSize,
    setInterviewOverlayLyricWidth,
    setInterviewOverlayLyricColor,
  } = useInterviewStore()

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
      await api.updateConfig({ answer_autoscroll_bottom_px: v, practice_audience: practiceAudience })
      useInterviewStore.getState().setConfig(await api.getConfig())
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

      <Section title="面试悬浮提示窗" icon={<Monitor className="w-3.5 h-3.5" />}>
        <p className="text-[11px] text-text-muted -mt-1 leading-relaxed">
          Electron 桌面端实验功能：面试时在屏幕边缘显示浮窗，支持面板或歌词两种模式。
        </p>
        <Field label="启用悬浮窗">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={interviewOverlayEnabled}
              onChange={(e) => setInterviewOverlayEnabled(e.target.checked)}
              className="w-4 h-4 rounded bg-bg-tertiary border-bg-hover text-accent-blue focus:ring-accent-blue focus:ring-offset-0"
            />
            <span className="text-xs text-text-secondary">{interviewOverlayEnabled ? '已开启' : '已关闭'}</span>
          </label>
        </Field>
        {interviewOverlayEnabled && (
          <>
            <Field label="显示模式">
              <div className="flex gap-2">
                {(['panel', 'lyrics'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setInterviewOverlayMode(m)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                      interviewOverlayMode === m
                        ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                        : 'border-bg-hover bg-bg-tertiary/30 text-text-secondary hover:border-bg-hover'
                    }`}
                  >
                    {m === 'panel' ? '面板' : '歌词'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={`不透明度: ${Math.round(interviewOverlayOpacity * 100)}%`}>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(interviewOverlayOpacity * 100)}
                onChange={(e) => setInterviewOverlayOpacity(Number(e.target.value) / 100)}
                className="w-full max-w-[200px]"
              />
            </Field>
            {interviewOverlayMode === 'panel' && (
              <>
                <Field label={`字号: ${interviewOverlayPanelFontSize}px`}>
                  <input
                    type="range"
                    min={1}
                    max={48}
                    value={interviewOverlayPanelFontSize}
                    onChange={(e) => setInterviewOverlayPanelFontSize(Number(e.target.value))}
                    className="w-full max-w-[200px]"
                  />
                </Field>
                <Field label="显示背景框">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={interviewOverlayPanelShowBg}
                      onChange={(e) => setInterviewOverlayPanelShowBg(e.target.checked)}
                      className="w-4 h-4 rounded bg-bg-tertiary border-bg-hover text-accent-blue focus:ring-accent-blue focus:ring-offset-0"
                    />
                    <span className="text-xs text-text-secondary">{interviewOverlayPanelShowBg ? '有背景' : '纯文字'}</span>
                  </label>
                </Field>
                <p className="text-[11px] text-text-muted leading-relaxed">面板宽度可在悬浮窗右侧边缘拖拽调整</p>
              </>
            )}
            {interviewOverlayMode === 'lyrics' && (
              <>
                <Field label={`行数: ${interviewOverlayLyricLines}`}>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={interviewOverlayLyricLines}
                    onChange={(e) => setInterviewOverlayLyricLines(Number(e.target.value))}
                    className="w-full max-w-[200px]"
                  />
                </Field>
                <Field label={`字号: ${interviewOverlayLyricFontSize}px`}>
                  <input
                    type="range"
                    min={1}
                    max={72}
                    value={interviewOverlayLyricFontSize}
                    onChange={(e) => setInterviewOverlayLyricFontSize(Number(e.target.value))}
                    className="w-full max-w-[200px]"
                  />
                </Field>
                <Field label={`宽度: ${interviewOverlayLyricWidth}px`}>
                  <input
                    type="range"
                    min={420}
                    max={1200}
                    step={20}
                    value={interviewOverlayLyricWidth}
                    onChange={(e) => setInterviewOverlayLyricWidth(Number(e.target.value))}
                    className="w-full max-w-[200px]"
                  />
                </Field>
                <Field label="字体颜色">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={interviewOverlayLyricColor}
                      onChange={(e) => setInterviewOverlayLyricColor(e.target.value)}
                      className="w-7 h-7 rounded border border-bg-hover cursor-pointer bg-transparent p-0"
                    />
                    <span className="text-xs text-text-secondary font-mono">{interviewOverlayLyricColor}</span>
                  </div>
                </Field>
              </>
            )}
          </>
        )}
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
