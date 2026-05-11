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
import { normalizePracticeTtsText, playBase64Audio, speakWithBrowserTts } from '@/lib/practiceTts'
import { Section, Field, GradientCard, StatusBadge, useSettingsSearch } from './shared'
import SttGuideCard from './SttGuideCard'

export default function SpeechTab() {
  const config = useInterviewStore((s) => s.config)
  const options = useInterviewStore((s) => s.options)
  const [form, setForm] = useState({
    stt_provider: 'whisper' as string,
    whisper_model: 'base',
    whisper_language: 'auto',
    doubao_stt_app_id: '',
    doubao_stt_access_token: '',
    doubao_stt_resource_id: 'volc.seedasr.sauc.duration',
    doubao_stt_boosting_table_id: '',
    generic_stt_api_base_url: '',
    generic_stt_api_key: '',
    generic_stt_model: '',
    practice_tts_provider: 'edge_tts' as string,
    edge_tts_voice_female: 'zh-CN-XiaoxiaoNeural',
    edge_tts_voice_male: 'zh-CN-YunxiNeural',
    edge_tts_rate: '+0%',
    edge_tts_pitch: '+0Hz',
    volcengine_tts_appkey: '',
    volcengine_tts_token: '',
    practice_tts_speaker_female: 'zh_female_qingxin',
    practice_tts_speaker_male: 'zh_male_chunhou',
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
  const [sttTestResult, setSttTestResult] = useState<{ ok: boolean; detail?: string; text?: string } | null>(null)
  const [ttsPreviewing, setTtsPreviewing] = useState(false)
  const [ttsPreviewText, setTtsPreviewText] = useState('欢迎来到模拟面试，现在请你用九十秒介绍一下自己。')

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
        generic_stt_api_base_url: config.generic_stt_api_base_url ?? '',
        generic_stt_api_key: config.generic_stt_api_key ?? '',
        generic_stt_model: config.generic_stt_model ?? '',
        practice_tts_provider: config.practice_tts_provider ?? 'edge_tts',
        edge_tts_voice_female: config.edge_tts_voice_female ?? 'zh-CN-XiaoxiaoNeural',
        edge_tts_voice_male: config.edge_tts_voice_male ?? 'zh-CN-YunxiNeural',
        edge_tts_rate: config.edge_tts_rate ?? '+0%',
        edge_tts_pitch: config.edge_tts_pitch ?? '+0Hz',
        volcengine_tts_appkey: config.volcengine_tts_appkey ?? '',
        volcengine_tts_token: config.volcengine_tts_token ?? '',
        practice_tts_speaker_female: config.practice_tts_speaker_female ?? 'zh_female_qingxin',
        practice_tts_speaker_male: config.practice_tts_speaker_male ?? 'zh_male_chunhou',
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
      await updateConfigAndRefresh(form)
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

  const handleTtsPreview = async () => {
    setTtsPreviewing(true)
    try {
      const text = ttsPreviewText.trim()
      if (!text) throw new Error('试听文本不能为空')
      const normalizedText = normalizePracticeTtsText(text)
      if (form.practice_tts_provider === 'volcengine' || form.practice_tts_provider === 'edge_tts') {
        const result = await api.practiceTts({
          text: normalizedText,
          preferred_gender: 'female',
          speaker: form.practice_tts_provider === 'edge_tts'
            ? (form.edge_tts_voice_female || undefined)
            : (form.practice_tts_speaker_female || undefined),
        })
        await playBase64Audio({
          audioBase64: result.audio_base64,
          contentType: result.content_type,
        })
        useInterviewStore.getState().setToastMessage(
          form.practice_tts_provider === 'edge_tts'
            ? `已试听 EdgeTTS 音色：${result.speaker}`
            : `已试听火山引擎音色：${result.speaker}`,
        )
      } else if (window.electronAPI?.synthesizeSystemTts) {
        const result = await window.electronAPI.synthesizeSystemTts({
          text: normalizedText,
          rate: 185,
        })
        await playBase64Audio({
          audioBase64: result.audio_base64,
          contentType: result.content_type,
        })
        useInterviewStore.getState().setToastMessage('已试听桌面系统语音')
      } else {
        const ok = await speakWithBrowserTts({
          text: normalizedText,
          synthesis: typeof window !== 'undefined' ? window.speechSynthesis : undefined,
          preferredGender: 'female',
          selectedVoiceURI: '',
        })
        if (!ok) throw new Error('本地试听失败')
        useInterviewStore.getState().setToastMessage('已试听浏览器本地语音')
      }
    } catch (e: any) {
      useInterviewStore.getState().setToastMessage(e?.message ?? '试听失败')
    } finally {
      setTtsPreviewing(false)
    }
  }

  const providers = options?.stt_providers ?? ['whisper', 'doubao', 'generic']
  const practiceTtsProviders = options?.practice_tts_providers ?? ['edge_tts', 'local', 'volcengine']

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
    if (provider === 'doubao') return !!(form.doubao_stt_app_id && form.doubao_stt_access_token)
    if (provider === 'generic') return !!(form.generic_stt_api_base_url && form.generic_stt_api_key && form.generic_stt_model)
    return false
  }

  const searchQuery = useSettingsSearch()
  const inSearch = searchQuery.trim().length > 0

  return (
    <div className="p-5 space-y-5 pb-8" data-in-search={inSearch ? '1' : undefined}>
      <Section title="语音识别引擎" icon={<Mic className="w-3.5 h-3.5" />} keywords="stt asr whisper funasr paraformer 识别引擎 model device 转写 sense-voice">
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

        {form.stt_provider === 'generic' && (
          <>
            <Field label="Base URL" hint="OpenAI-compatible 地址，例如 https://api.example.com/v1">
              <input type="text" value={form.generic_stt_api_base_url} onChange={(e) => setForm({ ...form, generic_stt_api_base_url: e.target.value })} placeholder="https://.../v1" className="input-field" />
            </Field>
            <Field label="API Key" hint="Bearer token">
              <input type="password" value={form.generic_stt_api_key} onChange={(e) => setForm({ ...form, generic_stt_api_key: e.target.value })} placeholder="填入 API Key" className="input-field" />
            </Field>
            <Field label="Model" hint="例如 whisper-1 / qwen-audio-asr / 供应商模型名">
              <input type="text" value={form.generic_stt_model} onChange={(e) => setForm({ ...form, generic_stt_model: e.target.value })} placeholder="模型名" className="input-field" />
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
            <div className="flex flex-col gap-1 min-w-0">
              <StatusBadge
                status={sttTestResult.ok ? 'ok' : 'error'}
                label={sttTestResult.ok ? '连接成功' : (sttTestResult.detail?.slice(0, 40) || '连接失败')}
              />
              {sttTestResult.ok && (
                <div className="text-[10px] text-text-muted max-w-[360px] truncate">
                  返回文本：{sttTestResult.text?.trim() || '空（测试音频为静音，接口可用）'}
                </div>
              )}
            </div>
          )}
        </div>
      </GradientCard>

      <Section title="模拟面试播报 (TTS)" icon={<Volume2 className="w-3.5 h-3.5" />} keywords="tts 发音人 播报 面试官 音色 男声 女声 volcengine">
        <Field label="播报方案" hint="本地 speechSynthesis 作为 fallback；云端只保留火山引擎">
          <select
            value={form.practice_tts_provider}
            onChange={(e) => setForm({ ...form, practice_tts_provider: e.target.value })}
            className="input-field"
          >
            {practiceTtsProviders.map((provider) => (
              <option key={provider} value={provider}>
                {provider === 'volcengine' ? '火山引擎 TTS' : provider === 'local' ? '本地合成兜底' : 'EdgeTTS 在线神经语音'}
              </option>
            ))}
          </select>
        </Field>

        {form.practice_tts_provider === 'edge_tts' && (
          <GradientCard className="p-4 space-y-3 border-emerald-400/30">
            <div className="flex items-center gap-3">
              <StatusBadge
                status={config?.edge_tts_available ? 'ok' : 'error'}
                label={config?.edge_tts_available ? 'EdgeTTS 已可用' : 'EdgeTTS 未就绪'}
              />
              <span className="text-xs text-text-muted">
                {config?.edge_tts_status_detail || '请先安装 edge-tts'}
              </span>
            </div>
            <Field label="默认女声音色" hint="EdgeTTS 支持大量中文神经音色">
              <input
                type="text"
                value={form.edge_tts_voice_female}
                onChange={(e) => setForm({ ...form, edge_tts_voice_female: e.target.value })}
                placeholder="如：zh-CN-XiaoxiaoNeural"
                className="input-field"
              />
            </Field>
            <Field label="默认男声音色" hint="如需更稳重的英文/中文读法可以换男声">
              <input
                type="text"
                value={form.edge_tts_voice_male}
                onChange={(e) => setForm({ ...form, edge_tts_voice_male: e.target.value })}
                placeholder="如：zh-CN-YunxiNeural"
                className="input-field"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="语速" hint="官方格式如 +0% / +10%">
                <input
                  type="text"
                  value={form.edge_tts_rate}
                  onChange={(e) => setForm({ ...form, edge_tts_rate: e.target.value })}
                  className="input-field"
                />
              </Field>
              <Field label="音高" hint="官方格式如 +0Hz / -10Hz">
                <input
                  type="text"
                  value={form.edge_tts_pitch}
                  onChange={(e) => setForm({ ...form, edge_tts_pitch: e.target.value })}
                  className="input-field"
                />
              </Field>
            </div>
            <Field label="说明" hint="EdgeTTS 轻很多，但依赖网络；适合先把体验跑顺">
              <input
                type="text"
                value="在线神经语音，无需 torch"
                readOnly
                className="input-field"
              />
            </Field>
          </GradientCard>
        )}

        {form.practice_tts_provider === 'volcengine' && (
          <GradientCard className="p-4 space-y-3 border-orange-400/30">
            <Field label="Appkey" hint="音频技术控制台创建应用后获得">
              <input
                type="text"
                value={form.volcengine_tts_appkey}
                onChange={(e) => setForm({ ...form, volcengine_tts_appkey: e.target.value })}
                placeholder="填入火山引擎 TTS appkey"
                className="input-field"
              />
            </Field>
            <Field label="Token" hint="可先使用控制台临时 token；正式接入再换成稳定 token 管理">
              <input
                type="password"
                value={form.volcengine_tts_token}
                onChange={(e) => setForm({ ...form, volcengine_tts_token: e.target.value })}
                placeholder="填入火山引擎 TTS token"
                className="input-field"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="默认女声 Speaker" hint="例如 zh_female_qingxin / zh_female_zhixing">
                <input
                  type="text"
                  value={form.practice_tts_speaker_female}
                  onChange={(e) => setForm({ ...form, practice_tts_speaker_female: e.target.value })}
                  className="input-field"
                />
              </Field>
              <Field label="默认男声 Speaker" hint="例如 zh_male_chunhou / zh_male_qinqie">
                <input
                  type="text"
                  value={form.practice_tts_speaker_male}
                  onChange={(e) => setForm({ ...form, practice_tts_speaker_male: e.target.value })}
                  className="input-field"
                />
              </Field>
            </div>
          </GradientCard>
        )}
        <GradientCard className="p-4 space-y-3 border-accent-blue/25">
          <Field label="试听文本" hint="保存前可以先快速听一下当前播报链路的效果">
            <textarea
              value={ttsPreviewText}
              onChange={(e) => setTtsPreviewText(e.target.value)}
              rows={3}
              className="input-field min-h-[88px] resize-y"
            />
          </Field>
          <button
            type="button"
            onClick={handleTtsPreview}
            disabled={ttsPreviewing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue/15 hover:bg-accent-blue/25 border border-accent-blue/30 text-accent-blue text-xs font-medium transition-colors disabled:opacity-60"
          >
            {ttsPreviewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Volume2 className="w-3.5 h-3.5" />}
            {ttsPreviewing ? '试听中…' : '试听当前播报方案'}
          </button>
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
            <input type="number" step="0.5" min="0.5" max="10" value={form.silence_duration}
              onChange={(e) => setForm({ ...form, silence_duration: parseFloat(e.target.value) })} className="input-field" />
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
