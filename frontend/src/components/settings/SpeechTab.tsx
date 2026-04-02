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
import { Section, Field, GradientCard, StatusBadge } from './shared'
import SttGuideCard from './SttGuideCard'

export default function SpeechTab() {
  const { config, options } = useInterviewStore()
  const [form, setForm] = useState({
    stt_provider: 'whisper' as string,
    whisper_model: 'base',
    whisper_language: 'auto',
    doubao_stt_app_id: '',
    doubao_stt_access_token: '',
    doubao_stt_resource_id: 'volc.seedasr.sauc.duration',
    doubao_stt_boosting_table_id: '',
    iflytek_stt_app_id: '',
    iflytek_stt_api_key: '',
    iflytek_stt_api_secret: '',
    silence_threshold: 0.01,
    silence_duration: 1.2,
    transcription_min_sig_chars: 2,
    assist_transcription_merge_gap_sec: 2.0,
    assist_transcription_merge_max_sec: 12.0,
    assist_high_churn_short_answer: false,
    auto_detect: true,
  })
  const [saving, setSaving] = useState(false)
  const [sttTesting, setSttTesting] = useState(false)
  const [sttTestResult, setSttTestResult] = useState<{ ok: boolean; detail?: string } | null>(null)

  useEffect(() => {
    if (config) {
      setForm({
        stt_provider: config.stt_provider ?? 'whisper',
        whisper_model: config.whisper_model,
        whisper_language: config.whisper_language ?? 'auto',
        doubao_stt_app_id: config.doubao_stt_app_id ?? '',
        doubao_stt_access_token: config.doubao_stt_access_token ?? '',
        doubao_stt_resource_id: config.doubao_stt_resource_id ?? 'volc.seedasr.sauc.duration',
        doubao_stt_boosting_table_id: config.doubao_stt_boosting_table_id ?? '',
        iflytek_stt_app_id: config.iflytek_stt_app_id ?? '',
        iflytek_stt_api_key: config.iflytek_stt_api_key ?? '',
        iflytek_stt_api_secret: config.iflytek_stt_api_secret ?? '',
        silence_threshold: config.silence_threshold,
        silence_duration: config.silence_duration,
        transcription_min_sig_chars: config.transcription_min_sig_chars ?? 2,
        assist_transcription_merge_gap_sec: config.assist_transcription_merge_gap_sec ?? 2.0,
        assist_transcription_merge_max_sec: config.assist_transcription_merge_max_sec ?? 12.0,
        assist_high_churn_short_answer: config.assist_high_churn_short_answer ?? false,
        auto_detect: config.auto_detect,
      })
      setSttTestResult(null)
    }
  }, [config])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.updateConfig(form)
      useInterviewStore.getState().setConfig(await api.getConfig())
      useInterviewStore.getState().setToastMessage('语音配置已保存')
    } catch (e: any) {
      useInterviewStore.getState().setToastMessage(e.message ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSttTest = async () => {
    setSttTesting(true)
    setSttTestResult(null)
    try {
      await handleSave()
      const result = await api.sttTest()
      setSttTestResult(result)
      useInterviewStore.getState().setToastMessage(result.ok ? 'STT 连接成功' : `STT 测试失败: ${result.detail}`)
    } catch (e: any) {
      setSttTestResult({ ok: false, detail: e.message })
    } finally {
      setSttTesting(false)
    }
  }

  const providers = options?.stt_providers ?? ['whisper', 'doubao', 'iflytek']

  const providerMeta: Record<string, { label: string; desc: string; icon: React.ReactNode; brandClass: string }> = {
    whisper: { label: 'Whisper', desc: '本地运行，免费无限', icon: <Volume2 className="w-5 h-5" />, brandClass: 'sky' },
    doubao: { label: '豆包', desc: '火山引擎云端 API', icon: <Zap className="w-5 h-5" />, brandClass: 'orange' },
    iflytek: { label: '讯飞', desc: '讯飞开放平台 API', icon: <Sparkles className="w-5 h-5" />, brandClass: 'blue' },
  }

  const brandBorder: Record<string, string> = {
    whisper: 'border-sky-400/40',
    doubao: 'border-orange-400/40',
    iflytek: 'border-blue-400/40',
  }

  const credentialConfigured = (provider: string): boolean => {
    if (provider === 'whisper') return true
    if (provider === 'doubao') return !!(form.doubao_stt_app_id && form.doubao_stt_access_token)
    if (provider === 'iflytek') return !!(form.iflytek_stt_app_id && form.iflytek_stt_api_key && form.iflytek_stt_api_secret)
    return false
  }

  return (
    <div className="p-5 space-y-5 pb-8">
      <Section title="语音识别引擎" icon={<Mic className="w-3.5 h-3.5" />}>
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

      <SttGuideCard provider={form.stt_provider} />

      {/* Engine-specific config with brand color border */}
      <GradientCard className={`p-4 space-y-3 transition-all duration-200 ${brandBorder[form.stt_provider] ?? ''}`}>
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
            <Field label="App ID" hint="火山引擎应用标识">
              <input type="text" value={form.doubao_stt_app_id} onChange={(e) => setForm({ ...form, doubao_stt_app_id: e.target.value })} placeholder="如：123456789" className="input-field" />
            </Field>
            <Field label="Access Token" hint="火山引擎 API 访问令牌">
              <input type="password" value={form.doubao_stt_access_token} onChange={(e) => setForm({ ...form, doubao_stt_access_token: e.target.value })} placeholder="填入 Access Token" className="input-field" />
            </Field>
            <Field label="Resource ID" hint="默认为流式语音识别 2.0 小时版">
              <input type="text" value={form.doubao_stt_resource_id} onChange={(e) => setForm({ ...form, doubao_stt_resource_id: e.target.value })} className="input-field" />
            </Field>
            <Field label="热词表 ID（可选）" hint="在自学习平台上传热词文件后获得">
              <input type="text" value={form.doubao_stt_boosting_table_id} onChange={(e) => setForm({ ...form, doubao_stt_boosting_table_id: e.target.value })} placeholder="留空则不使用" className="input-field" />
            </Field>
          </>
        )}

        {form.stt_provider === 'iflytek' && (
          <>
            <Field label="APPID" hint="讯飞开放平台应用 ID">
              <input type="text" value={form.iflytek_stt_app_id} onChange={(e) => setForm({ ...form, iflytek_stt_app_id: e.target.value })} placeholder="如：5f9a8b7c" className="input-field" />
            </Field>
            <Field label="APIKey" hint="讯飞应用的 APIKey">
              <input type="password" value={form.iflytek_stt_api_key} onChange={(e) => setForm({ ...form, iflytek_stt_api_key: e.target.value })} placeholder="填入 APIKey" className="input-field" />
            </Field>
            <Field label="APISecret" hint="讯飞应用的 APISecret">
              <input type="password" value={form.iflytek_stt_api_secret} onChange={(e) => setForm({ ...form, iflytek_stt_api_secret: e.target.value })} placeholder="填入 APISecret" className="input-field" />
            </Field>
          </>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSttTest}
            disabled={sttTesting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue/15 hover:bg-accent-blue/25 border border-accent-blue/30 text-accent-blue text-xs font-medium transition-colors disabled:opacity-60"
          >
            {sttTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {sttTesting ? '测试中…' : '测试连接'}
          </button>
          {sttTestResult && (
            <StatusBadge
              status={sttTestResult.ok ? 'ok' : 'error'}
              label={sttTestResult.ok ? '连接成功' : (sttTestResult.detail?.slice(0, 40) || '连接失败')}
            />
          )}
        </div>
      </GradientCard>

      <Section title="语音活动检测 (VAD)" icon={<Settings2 className="w-3.5 h-3.5" />}>
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
            <input type="number" step="0.5" min="0.5" max="10" value={form.silence_duration}
              onChange={(e) => setForm({ ...form, silence_duration: parseFloat(e.target.value) })} className="input-field" />
          </Field>
        </div>
        <Field label="转写最少有效字" hint="去标点只计汉字/英文/数字；低于则不触发（如过滤「嗯」）">
          <input type="number" min={1} max={50} step={1} value={form.transcription_min_sig_chars}
            onChange={(e) => setForm({ ...form, transcription_min_sig_chars: Math.max(1, parseInt(e.target.value, 10) || 1) })} className="input-field" />
        </Field>
      </Section>

      <Section title="转写合并与自动答题">
        <div className="grid grid-cols-2 gap-3">
          <Field label="合并间隔 (秒)" hint="上一段结束后静默超过该时间送出；0=每段立即发">
            <input type="number" step="0.5" min={0} max={15} value={form.assist_transcription_merge_gap_sec}
              onChange={(e) => setForm({ ...form, assist_transcription_merge_gap_sec: Math.max(0, Math.min(15, parseFloat(e.target.value) || 0)) })}
              className="input-field" />
          </Field>
          <Field label="最长等待 (秒)" hint="从首段起超过该时间强制送出">
            <input type="number" step={1} min={1} max={120} value={form.assist_transcription_merge_max_sec}
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
        <label className="flex items-center gap-2 cursor-pointer mt-2">
          <input type="checkbox" checked={form.assist_high_churn_short_answer}
            onChange={(e) => setForm({ ...form, assist_high_churn_short_answer: e.target.checked })}
            className="w-4 h-4 rounded bg-bg-tertiary border-bg-hover text-accent-blue focus:ring-accent-blue focus:ring-offset-0" />
          <div>
            <span className="text-xs text-text-secondary">高 churn 短答模式</span>
            <p className="text-[10px] text-text-muted leading-snug">问题切换频繁时自动切成更短回答，优先跟住最新问题。</p>
          </div>
        </label>
      </Section>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {saving ? '保存中…' : '保存语音配置'}
      </button>
    </div>
  )
}
