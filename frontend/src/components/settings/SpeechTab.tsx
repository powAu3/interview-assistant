import { useState, useEffect } from 'react'
import {
  Save,
  Mic,
  Zap,
  Sparkles,
  Volume2,
  Loader2,
  HelpCircle,
  Settings2,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { api } from '@/lib/api'
import { updateConfigAndRefresh } from '@/lib/configSync'
import {
  Section,
  Field,
  GradientCard,
  SaveStateBadge,
  StatusBadge,
  useDirtySnapshot,
  useSettingsDirtyRegistration,
  useSettingsSearch,
  type SaveState,
} from './shared'
import SttGuideCard from './SttGuideCard'
import BetaBadge from '@/components/kb/BetaBadge'

export default function SpeechTab() {
  const config = useInterviewStore((s) => s.config)
  const options = useInterviewStore((s) => s.options)
  const [form, setForm] = useState({
    stt_provider: 'whisper' as string,
    whisper_model: 'base',
    whisper_language: 'auto',
    whisper_preload: false,
    doubao_stt_app_id: '',
    doubao_stt_access_token: '',
    doubao_stt_api_key: '',
    doubao_stt_resource_id: 'volc.seedasr.sauc.duration',
    doubao_stt_boosting_table_id: '',
    generic_stt_api_base_url: '',
    generic_stt_api_key: '',
    generic_stt_model: '',
    generic_stt_custom_headers: '',
    candidate_asr_enabled: false,
    candidate_stt_provider: 'whisper',
    candidate_whisper_model: '',
    candidate_whisper_language: '',
    candidate_remote_stt_enabled: false,
    candidate_context_enabled: true,
    candidate_context_wait_ms: 200,
    candidate_context_max_chars: 900,
    candidate_context_min_chars: 6,
    candidate_streaming_asr_enabled: true,
    candidate_streaming_asr_interval_ms: 1500,
    candidate_mic_compatibility_mode: true,
    silence_threshold: 0.01,
    silence_duration: 1.2,
    transcription_min_sig_chars: 2,
    assist_transcription_merge_gap_sec: 2.0,
    assist_transcription_merge_max_sec: 12.0,
    assist_high_churn_short_answer: false,
    auto_detect: true,
  })
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [sttTesting, setSttTesting] = useState(false)
  const [sttTestResult, setSttTestResult] = useState<{ ok: boolean; detail?: string; text?: string } | null>(null)
  const { dirty, markSaved, resetBaseline } = useDirtySnapshot(form)
  useSettingsDirtyRegistration('speech', dirty)

  useEffect(() => {
    if (config) {
      const nextForm = {
        stt_provider: config.stt_provider ?? 'whisper',
        whisper_model: config.whisper_model,
        whisper_language: config.whisper_language ?? 'auto',
        whisper_preload: config.whisper_preload ?? false,
        doubao_stt_app_id: config.doubao_stt_app_id ?? '',
        doubao_stt_access_token: config.doubao_stt_access_token ?? '',
        doubao_stt_api_key: config.doubao_stt_api_key ?? '',
        doubao_stt_resource_id: config.doubao_stt_resource_id ?? 'volc.seedasr.sauc.duration',
        doubao_stt_boosting_table_id: config.doubao_stt_boosting_table_id ?? '',
        generic_stt_api_base_url: config.generic_stt_api_base_url ?? '',
        generic_stt_api_key: config.generic_stt_api_key ?? '',
        generic_stt_model: config.generic_stt_model ?? '',
        generic_stt_custom_headers: config.generic_stt_custom_headers ?? '',
        candidate_asr_enabled: config.candidate_asr_enabled ?? false,
        candidate_stt_provider: config.candidate_stt_provider ?? 'whisper',
        candidate_whisper_model: config.candidate_whisper_model ?? '',
        candidate_whisper_language: config.candidate_whisper_language ?? '',
        candidate_remote_stt_enabled: config.candidate_remote_stt_enabled ?? false,
        candidate_context_enabled: config.candidate_context_enabled ?? true,
        candidate_context_wait_ms: config.candidate_context_wait_ms ?? 200,
        candidate_context_max_chars: config.candidate_context_max_chars ?? 900,
        candidate_context_min_chars: config.candidate_context_min_chars ?? 6,
        candidate_streaming_asr_enabled: config.candidate_streaming_asr_enabled ?? true,
        candidate_streaming_asr_interval_ms: config.candidate_streaming_asr_interval_ms ?? 1500,
        candidate_mic_compatibility_mode: config.candidate_mic_compatibility_mode ?? true,
        silence_threshold: config.silence_threshold,
        silence_duration: config.silence_duration,
        transcription_min_sig_chars: config.transcription_min_sig_chars ?? 2,
        assist_transcription_merge_gap_sec: config.assist_transcription_merge_gap_sec ?? 2.0,
        assist_transcription_merge_max_sec: config.assist_transcription_merge_max_sec ?? 12.0,
        assist_high_churn_short_answer: config.assist_high_churn_short_answer ?? false,
        auto_detect: config.auto_detect,
      }
      if (dirty) return
      setForm(nextForm)
      resetBaseline(nextForm)
      setSttTestResult(null)
    }
  }, [config, dirty, resetBaseline])

  const handleSave = async () => {
    setSaving(true)
    setSaveState('saving')
    setSaveError(null)
    try {
      await updateConfigAndRefresh({
        ...form,
        candidate_remote_stt_enabled: form.candidate_stt_provider !== 'whisper',
      })
      markSaved(form)
      setSaveState('saved')
      useInterviewStore.getState().setToastMessage('语音配置已保存')
      return true
    } catch (e: any) {
      const message = e?.message ?? '保存失败'
      setSaveError(message)
      setSaveState('error')
      useInterviewStore.getState().setToastMessage(message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleSttTest = async () => {
    setSttTesting(true)
    setSttTestResult(null)
    try {
      const saved = await handleSave()
      if (!saved) {
        setSttTestResult({ ok: false, detail: '当前语音配置保存失败，请先修复后再测试。' })
        return
      }
      const result = await api.sttTest()
      setSttTestResult(result)
      useInterviewStore.getState().setToastMessage(result.ok ? 'STT 连接成功' : `STT 测试失败: ${result.detail}`)
    } catch (e: any) {
      setSttTestResult({ ok: false, detail: e.message })
    } finally {
      setSttTesting(false)
    }
  }

  const providers = options?.stt_providers ?? ['whisper', 'doubao', 'generic']
  const providerSupported = providers.includes(form.stt_provider)

  const providerMeta: Record<string, { label: string; desc: string; icon: React.ReactNode; brandClass: string }> = {
    whisper: { label: 'Whisper', desc: '本地运行，免费无限', icon: <Volume2 className="w-5 h-5" />, brandClass: 'sky' },
    doubao: { label: '豆包', desc: '火山引擎云端 API', icon: <Zap className="w-5 h-5" />, brandClass: 'orange' },
    generic: { label: '通用 ASR', desc: 'OpenAI-compatible multipart', icon: <Sparkles className="w-5 h-5" />, brandClass: 'blue' },
  }

  const brandBorder: Record<string, string> = {
    whisper: 'border-sky-400/40',
    doubao: 'border-orange-400/40',
    generic: 'border-blue-400/40',
  }

  const credentialConfigured = (provider: string): boolean => {
    if (provider === 'whisper') return true
    if (provider === 'doubao') return !!(form.doubao_stt_api_key || (form.doubao_stt_app_id && form.doubao_stt_access_token))
    if (provider === 'generic') return !!(form.generic_stt_api_base_url && form.generic_stt_api_key && form.generic_stt_model)
    return false
  }

  const mainSttLabel = providerMeta[form.stt_provider]?.label ?? form.stt_provider
  const candidateSttLabel = form.candidate_stt_provider === 'whisper'
    ? 'Whisper 本地'
    : form.candidate_stt_provider === 'doubao'
      ? '豆包云端'
      : '通用云端'
  const candidateContextActive = form.candidate_asr_enabled && form.candidate_context_enabled
  const searchQuery = useSettingsSearch()
  const inSearch = searchQuery.trim().length > 0
  const effectiveSaveState: SaveState = saveState === 'saving' || saveState === 'error'
    ? saveState
    : dirty
      ? 'dirty'
      : saveState === 'saved'
        ? 'saved'
      : 'idle'

  return (
    <div className="p-5 space-y-5 pb-8" data-in-search={inSearch ? '1' : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bg-hover/60 bg-bg-primary/35 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">语音链路</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
            STT、TTS、麦克风和断句参数需要保存后才会影响运行链路。
          </p>
        </div>
        <SaveStateBadge mode="explicit" state={effectiveSaveState} error={saveError} />
      </div>

      <Section title="实时辅助语音链路" icon={<Mic className="w-3.5 h-3.5" />} keywords="实时辅助 双路 asr 面试官 候选人 麦克风 追问">
        <GradientCard className="p-4 border-accent-blue/25">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-bg-hover bg-bg-tertiary/30 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-text-primary">1. 面试官 / 会议音频 ASR</h3>
                <StatusBadge status="ok" label="主链路" />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                识别控制条里的“会议音频”。识别到面试官问题后，会继续走自动判题、追问判断和生成答案链路。
              </p>
              <p className="mt-2 text-[11px] text-text-muted">当前：{mainSttLabel}，这是下面“主链路 ASR”的配置。</p>
            </div>
            <div className="rounded-lg border border-bg-hover bg-bg-tertiary/30 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-text-primary">2. 我的麦克风 ASR</h3>
                <StatusBadge status={form.candidate_asr_enabled ? 'ok' : 'idle'} label={form.candidate_asr_enabled ? '辅助上下文' : '已关闭'} />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                只识别你实际说出口的回答，写入追问上下文；不会触发自动答题，也不会混入面试官问题流。
              </p>
              <p className="mt-2 text-[11px] text-text-muted">
                当前：{form.candidate_asr_enabled ? `${candidateSttLabel}，追问${candidateContextActive ? '优先使用真实口述' : '按旧逻辑'}` : '不读取麦克风，完全按旧逻辑追问'}。
              </p>
            </div>
          </div>
        </GradientCard>
      </Section>

      <Section title="主链路 ASR（面试官 / 会议音频）" icon={<Mic className="w-3.5 h-3.5" />} keywords="stt asr whisper funasr paraformer 识别引擎 model device 转写 sense-voice 面试官 会议音频">
        <div className="grid grid-cols-3 gap-2">
          {providers.map((p) => {
            const meta = providerMeta[p] || { label: p, desc: '', icon: <Mic className="w-5 h-5" />, brandClass: 'blue' }
            const sel = form.stt_provider === p
            const cred = credentialConfigured(p)
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setForm({ ...form, stt_provider: p })
                  setSttTestResult(null)
                }}
                className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all duration-200 ${
                  sel
                    ? `${brandBorder[p] ?? 'border-accent-blue'} bg-accent-blue/10 ring-1 ring-accent-blue/30 shadow-md`
                    : 'border-bg-hover bg-bg-tertiary/30 hover:border-bg-hover hover:bg-bg-tertiary/50'
                }`}
              >
                <span className={sel ? 'text-accent-blue' : 'text-text-muted'}>{meta.icon}</span>
                <span className="text-xs font-semibold text-text-primary">{meta.label}</span>
                <span className="text-[9px] text-text-muted leading-snug">{meta.desc}</span>
                {/* credential status dot */}
                <span className={`absolute top-2 right-2 flex items-center gap-1`}>
                  {cred
                    ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    : p !== 'whisper' ? <XCircle className="w-3 h-3 text-red-400/60" /> : null}
                </span>
              </button>
            )
          })}
        </div>
      </Section>

      {!providerSupported && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          当前配置中的 STT provider 为 `{form.stt_provider}`，该 provider 已不再受支持。
          请切换到“通用 ASR”或“Whisper”后保存，再重新测试连接。
        </div>
      )}

      <SttGuideCard provider={form.stt_provider} />

      {/* Engine-specific config with brand color border */}
      <GradientCard className={`p-4 space-y-3 transition-all duration-200 ${brandBorder[form.stt_provider] ?? ''}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">面试官 ASR 引擎配置</h3>
            <p className="text-[11px] text-text-muted mt-0.5">
              这一路识别面试官声音，识别出的题目会触发自动生成答案。
            </p>
          </div>
          <StatusBadge
            status={credentialConfigured(form.stt_provider) ? 'ok' : 'error'}
            label={credentialConfigured(form.stt_provider) ? '配置完整' : '待补全'}
          />
        </div>

        {form.stt_provider === 'whisper' && (
          <>
            <Field label="Whisper 模型" hint="模型越大越准确但越慢，base 适合大多数场景">
              <select value={form.whisper_model} onChange={(e) => setForm({ ...form, whisper_model: e.target.value })} className="input-field">
                {(options?.whisper_models ?? ['tiny', 'base', 'small', 'medium', 'large-v3']).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="识别语言" hint="auto = 自动检测（推荐），适合中英混合面试">
              <select value={form.whisper_language} onChange={(e) => setForm({ ...form, whisper_language: e.target.value })} className="input-field">
                <option value="auto">自动检测 (auto)</option>
                <option value="zh">中文 (zh)</option>
                <option value="en">English (en)</option>
                <option value="ja">日本語 (ja)</option>
              </select>
            </Field>
          </>
        )}

        {form.stt_provider === 'doubao' && (
          <>
            <Field label="API Key（新版控制台）" hint="优先使用；火山引擎新版控制台 API Key 管理中获取">
              <input type="text" value={form.doubao_stt_api_key} onChange={(e) => setForm({ ...form, doubao_stt_api_key: e.target.value })} placeholder="填入 API Key（UUID 格式）" className="input-field" />
            </Field>
            <Field label="App ID（旧版控制台）" hint="使用旧版控制台时填写，新版无需填">
              <input type="text" value={form.doubao_stt_app_id} onChange={(e) => setForm({ ...form, doubao_stt_app_id: e.target.value })} placeholder="如：123456789" className="input-field" />
            </Field>
            <Field label="Access Token（旧版控制台）" hint="使用旧版控制台时填写，新版无需填">
              <input type="text" value={form.doubao_stt_access_token} onChange={(e) => setForm({ ...form, doubao_stt_access_token: e.target.value })} placeholder="填入 Access Token" className="input-field" />
            </Field>
            <Field label="Resource ID" hint="默认为流式语音识别 1.0 小时版">
              <input type="text" value={form.doubao_stt_resource_id} onChange={(e) => setForm({ ...form, doubao_stt_resource_id: e.target.value })} className="input-field" />
            </Field>
            <Field label="热词表 ID（可选）" hint="在自学习平台上传热词文件后获得">
              <input type="text" value={form.doubao_stt_boosting_table_id} onChange={(e) => setForm({ ...form, doubao_stt_boosting_table_id: e.target.value })} placeholder="留空则不使用" className="input-field" />
            </Field>
          </>
        )}

        {form.stt_provider === 'generic' && (
          <>
            <Field label="Base URL" hint="OpenAI-compatible 地址，例如 https://api.example.com/v1">
              <input type="text" value={form.generic_stt_api_base_url} onChange={(e) => setForm({ ...form, generic_stt_api_base_url: e.target.value })} placeholder="https://.../v1" className="input-field" />
            </Field>
            <Field label="API Key" hint="Bearer token">
              <input type="text" value={form.generic_stt_api_key} onChange={(e) => setForm({ ...form, generic_stt_api_key: e.target.value })} placeholder="填入 API Key" className="input-field" />
            </Field>
            <Field label="Model" hint="例如 whisper-1 / qwen-audio-asr / 供应商模型名">
              <input type="text" value={form.generic_stt_model} onChange={(e) => setForm({ ...form, generic_stt_model: e.target.value })} placeholder="模型名" className="input-field" />
            </Field>
            <Field label="自定义 Header（可选）" hint='JSON {"Key":"Value"} 或每行 Key: Value，追加到请求头'>
              <textarea value={form.generic_stt_custom_headers} onChange={(e) => setForm({ ...form, generic_stt_custom_headers: e.target.value })} placeholder='{"X-Custom-Header": "value"}&#10;或&#10;X-Custom-Header: value' rows={3} className="input-field min-h-[66px] resize-y font-mono text-xs" />
            </Field>
          </>
        )}

        {form.stt_provider !== 'whisper' && (
          <Field label="Whisper 降级预加载" hint="默认关闭；开启后启动时后台加载 Whisper（约 300MB 内存），远程 ASR 故障时更快降级">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.whisper_preload} onChange={(e) => setForm({ ...form, whisper_preload: e.target.checked })} className="rounded border-border text-accent-blue focus:ring-accent-blue/30" />
              <span className="text-xs text-text-secondary">{form.whisper_preload ? '已启用' : '已关闭'}</span>
            </label>
          </Field>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSttTest}
            disabled={sttTesting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue/15 hover:bg-accent-blue/25 border border-accent-blue/30 text-accent-blue text-xs font-medium transition-colors disabled:opacity-60"
          >
            {sttTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {sttTesting ? '测试中…' : '保存并测试'}
          </button>
          <span className="text-[10px] leading-relaxed text-text-muted">会先保存当前语音配置，再测试主链路 ASR。</span>
          {sttTestResult && (
            <div className="flex flex-col gap-1 min-w-0">
              <StatusBadge
                status={sttTestResult.ok ? 'ok' : 'error'}
                label={sttTestResult.ok ? '连接成功' : (sttTestResult.detail?.slice(0, 40) || '连接失败')}
              />
              {sttTestResult.ok && (
                <div className="text-[10px] text-text-muted max-w-[360px] truncate">
                  返回文本：{sttTestResult.text?.trim() || '空'}
                </div>
              )}
            </div>
          )}
        </div>
      </GradientCard>

      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            可选辅助 ASR（我的回答）
            <BetaBadge title="我的麦克风 ASR — Beta" className="scale-90 origin-left" />
          </span>
        }
        icon={<Mic className="w-3.5 h-3.5" />}
        keywords="candidate mic microphone asr 候选人 麦克风 真实回答 追问上下文 成本 beta"
      >
        <GradientCard className="p-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-primary">我的回答上下文（麦克风）</h3>
              <p className="text-[11px] leading-relaxed text-text-muted mt-0.5">
                只用于记录你真实说出口的回答，给下一轮追问做上下文；不会触发自动答题。
              </p>
            </div>
            <div className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-bg-hover bg-bg-tertiary/45 px-2.5 py-2">
              <span className={`text-xs font-medium ${form.candidate_asr_enabled ? 'text-emerald-400' : 'text-text-muted'}`}>
                {form.candidate_asr_enabled ? '已开启' : '已关闭'}
              </span>
              <button
                type="button"
                role="switch"
                aria-label="我的回答上下文（麦克风）"
                aria-checked={form.candidate_asr_enabled}
                onClick={() => {
                  const enabled = !form.candidate_asr_enabled
                  setForm({
                    ...form,
                    candidate_asr_enabled: enabled,
                  })
                }}
                className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent-blue/30 ${
                  form.candidate_asr_enabled ? 'bg-emerald-500/80' : 'bg-bg-hover'
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    form.candidate_asr_enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
          {!form.candidate_asr_enabled && (
            <div className="rounded-lg border border-bg-hover bg-bg-tertiary/40 px-3 py-2 text-xs text-text-muted">
              当前已关闭我的麦克风 ASR：启动面试时不会传入“我的麦克风”设备，追问上下文会退回旧的模型答案链路。
            </div>
          )}
          {form.candidate_asr_enabled && (
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs leading-relaxed text-text-secondary">
              开启后控制条会多选一路“我的麦克风”。这一路只用共享方式读取；如果会议软件独占麦克风，会自动关闭我的口述记录，不影响面试录音。
            </div>
          )}

          <Field label="麦克风兼容模式" hint="推荐开启。只使用共享读取；冲突时尝试更保守采样和默认输入设备，失败则关闭候选人口述，不抢会议软件麦克风。">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.candidate_mic_compatibility_mode}
                onChange={(e) => setForm({ ...form, candidate_mic_compatibility_mode: e.target.checked })}
                className="rounded border-border text-accent-blue focus:ring-accent-blue/30"
                disabled={!form.candidate_asr_enabled}
              />
              <span className="text-xs text-text-secondary">
                {form.candidate_mic_compatibility_mode ? '共享兼容优先' : '仅按所选麦克风尝试'}
              </span>
            </label>
          </Field>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="我的语音识别引擎" hint="默认 Whisper 本地识别，不产生远程 ASR 成本">
              <select
                value={form.candidate_stt_provider}
                onChange={(e) => {
                const nextProvider = e.target.value
                setForm({
                  ...form,
                  candidate_stt_provider: nextProvider,
                  candidate_remote_stt_enabled: nextProvider !== 'whisper',
                })
              }}
                className="input-field"
                disabled={!form.candidate_asr_enabled}
              >
                {providers.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider === 'whisper'
                      ? 'Whisper（本地，免费）'
                      : provider === 'doubao'
                        ? '豆包（云端，会增加成本）'
                        : '通用 ASR（云端，会增加成本）'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="下一题使用真实回答上下文" hint="开启后下一轮问题会带上你的真实口述；追问时强优先，非追问时只作背景">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.candidate_context_enabled}
                  onChange={(e) => setForm({ ...form, candidate_context_enabled: e.target.checked })}
                  className="rounded border-border text-accent-blue focus:ring-accent-blue/30"
                  disabled={!form.candidate_asr_enabled}
                />
                <span className="text-xs text-text-secondary">{
                  !form.candidate_asr_enabled
                    ? (form.candidate_context_enabled ? '开启麦克风后生效' : '按旧逻辑')
                    : (candidateContextActive ? '下一题携带真实口述' : '按旧逻辑')
                }</span>
              </label>
            </Field>
          </div>
          {form.candidate_asr_enabled && form.candidate_stt_provider !== 'whisper' && (
            <div className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-text-secondary">
              已选择云端麦克风 ASR：我的麦克风转写会调用对应云端接口并产生额外成本。切回 Whisper 即恢复本地免费识别。
            </div>
          )}

          <details className="group rounded-lg border border-bg-hover bg-bg-tertiary/25 px-3 py-2">
            <summary className="cursor-pointer select-none text-xs font-medium text-text-secondary group-open:text-text-primary">
              高级设置：Whisper 模型与追问上下文
            </summary>
            <div className="mt-3 space-y-3">
              <div className="rounded-lg border border-bg-hover bg-bg-secondary/40 px-3 py-2 text-xs leading-relaxed text-text-secondary">
                上下文流程：先由“会议音频”识别面试官问题；生成下一轮答案时会携带上一轮“我的麦克风”真实转写作为背景。若系统判断这是追问，真实口述会强优先；若不是追问，真实口述只作背景，和当前问题无关时会被忽略。
              </div>

              <Field label="边听边写" hint="开启后会一边听你的麦克风一边预转写；面试官提下一题时，直接使用已经写入的内容。停顿后再用完整结果覆盖。云端 ASR 不做预转写，避免反复计费。">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.candidate_streaming_asr_enabled}
                    onChange={(e) => setForm({ ...form, candidate_streaming_asr_enabled: e.target.checked })}
                    className="rounded border-border text-accent-blue focus:ring-accent-blue/30"
                    disabled={!form.candidate_asr_enabled || form.candidate_stt_provider !== 'whisper'}
                  />
                  <span className="text-xs text-text-secondary">
                    {form.candidate_stt_provider === 'whisper'
                      ? form.candidate_streaming_asr_enabled ? '已开启' : '已关闭'
                      : '云端 ASR 不做预转写'}
                  </span>
                </label>
              </Field>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="我的 Whisper 模型" hint="留空则沿用主链路 Whisper 模型">
                  <select
                    value={form.candidate_whisper_model}
                    onChange={(e) => setForm({ ...form, candidate_whisper_model: e.target.value })}
                    className="input-field"
                    disabled={!form.candidate_asr_enabled}
                  >
                    <option value="">沿用主配置 ({form.whisper_model})</option>
                    {(options?.whisper_models ?? ['tiny', 'base', 'small', 'medium', 'large-v3']).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </Field>
                <Field label="我的识别语言" hint="留空则沿用主链路语言">
                  <select
                    value={form.candidate_whisper_language}
                    onChange={(e) => setForm({ ...form, candidate_whisper_language: e.target.value })}
                    className="input-field"
                    disabled={!form.candidate_asr_enabled}
                  >
                    <option value="">沿用主配置 ({form.whisper_language})</option>
                    <option value="auto">自动检测 (auto)</option>
                    <option value="zh">中文 (zh)</option>
                    <option value="en">English (en)</option>
                    <option value="ja">日本語 (ja)</option>
                  </select>
                </Field>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <Field label="边写刷新间隔 (ms)" hint="每隔多久尝试把你正在说的话写进上下文。拿不到本地 Whisper 空闲资源时会跳过本次，优先保证面试官 ASR。">
                  <input
                    type="number"
                    min={800}
                    max={5000}
                    step={100}
                    value={form.candidate_streaming_asr_interval_ms}
                    onChange={(e) => setForm({ ...form, candidate_streaming_asr_interval_ms: Math.max(800, Math.min(5000, parseInt(e.target.value, 10) || 1500)) })}
                    className="input-field"
                    disabled={!form.candidate_asr_enabled || !form.candidate_streaming_asr_enabled || form.candidate_stt_provider !== 'whisper'}
                  />
                </Field>
                <Field label="兜底等最后一句 (ms)" hint="边听边写已经会提前写入上下文；这个只是在你刚说完、最后一句还没写进去时，下一题生成前最多再等一下。0=不等。">
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    step={50}
                    value={form.candidate_context_wait_ms}
                    onChange={(e) => setForm({ ...form, candidate_context_wait_ms: Math.max(0, Math.min(2000, parseInt(e.target.value, 10) || 0)) })}
                    className="input-field"
                    disabled={!form.candidate_asr_enabled || !form.candidate_context_enabled}
                  />
                </Field>
                <Field label="上下文字数" hint="注入下一轮 prompt 的真实回答上限">
                  <input
                    type="number"
                    min={100}
                    max={4000}
                    step={100}
                    value={form.candidate_context_max_chars}
                    onChange={(e) => setForm({ ...form, candidate_context_max_chars: Math.max(100, Math.min(4000, parseInt(e.target.value, 10) || 900)) })}
                    className="input-field"
                    disabled={!form.candidate_asr_enabled || !form.candidate_context_enabled}
                  />
                </Field>
                <Field label="最少有效字" hint="太短的候选人转写不作为上下文">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={form.candidate_context_min_chars}
                    onChange={(e) => setForm({ ...form, candidate_context_min_chars: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 6)) })}
                    className="input-field"
                    disabled={!form.candidate_asr_enabled || !form.candidate_context_enabled}
                  />
                </Field>
              </div>
            </div>
          </details>
        </GradientCard>
      </Section>

      <Section title="语音活动检测 (VAD)" icon={<Settings2 className="w-3.5 h-3.5" />} keywords="vad silence 静音 断句 阈值 silero 语音活动">
        <div className="bg-bg-tertiary/30 rounded-lg p-3 text-xs text-text-muted space-y-1.5 mb-2">
          <div className="flex items-start gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-accent-blue" />
            <span>根据音量与静音时长判断一句是否说完。</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="静音阈值" hint="环境吵可调高">
            <input type="number" step="0.005" min="0.001" max="0.1" value={form.silence_threshold}
              onChange={(e) => setForm({ ...form, silence_threshold: parseFloat(e.target.value) })} className="input-field" />
          </Field>
          <Field label="静音时长 (秒)" hint="说完判定">
            <input type="number" step="0.1" min="0.5" max="10" value={form.silence_duration}
              onChange={(e) => setForm({ ...form, silence_duration: parseFloat(e.target.value) || 1.2 })} className="input-field" />
          </Field>
        </div>
        <Field label="转写最少有效字" hint="去标点只计汉字/英文/数字；低于则不触发（如过滤「嗯」）">
          <input type="number" min={1} max={50} step={1} value={form.transcription_min_sig_chars}
            onChange={(e) => setForm({ ...form, transcription_min_sig_chars: Math.max(1, parseInt(e.target.value, 10) || 1) })} className="input-field" />
        </Field>
      </Section>

      <Section title="转写合并与自动答题" keywords="合并 merge auto answer 自动答题 gap interval seconds 间隔">
        <div className="grid grid-cols-2 gap-3">
          <Field label="合并间隔 (秒)" hint="上一段结束后静默超过该时间送出；0=每段立即发">
            <input type="number" step="0.1" min={0} max={15} value={form.assist_transcription_merge_gap_sec}
              onChange={(e) => setForm({ ...form, assist_transcription_merge_gap_sec: Math.max(0, Math.min(15, parseFloat(e.target.value) || 0)) })}
              className="input-field" />
          </Field>
          <Field label="最长等待 (秒)" hint="从首段起超过该时间强制送出">
            <input type="number" step="0.1" min={1} max={120} value={form.assist_transcription_merge_max_sec}
              onChange={(e) => setForm({ ...form, assist_transcription_merge_max_sec: Math.max(1, Math.min(120, parseFloat(e.target.value) || 12)) })}
              className="input-field" />
          </Field>
        </div>
        <label className="flex items-center gap-2 cursor-pointer mt-2">
          <input type="checkbox" checked={form.auto_detect}
            onChange={(e) => setForm({ ...form, auto_detect: e.target.checked })}
            className="w-4 h-4 rounded bg-bg-tertiary border-bg-hover text-accent-blue focus:ring-accent-blue focus:ring-offset-0" />
          <span className="text-xs text-text-secondary">自动检测问题并生成答案</span>
        </label>
        <Field label="回答长度" hint="和常用页的回答长度设置一致，保存语音配置后生效">
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: false, label: '详细回答', hint: '解释更完整' },
              { value: true, label: '简短回答', hint: '更快跟住问题' },
            ]).map((item) => {
              const selected = form.assist_high_churn_short_answer === item.value
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setForm({ ...form, assist_high_churn_short_answer: item.value })}
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
        </Field>
      </Section>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {saving ? '保存中…' : '保存语音配置'}
      </button>
      <div className="flex justify-center">
        <SaveStateBadge mode="explicit" state={effectiveSaveState} error={saveError} />
      </div>
    </div>
  )
}
