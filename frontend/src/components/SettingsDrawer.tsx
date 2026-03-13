import { useState, useEffect } from 'react'
import { X, Save, AlertTriangle, HelpCircle } from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { api } from '@/lib/api'

export default function SettingsDrawer() {
  const { settingsOpen, toggleSettings, config, options, platformInfo, sttLoaded, sttLoading } = useInterviewStore()

  const [form, setForm] = useState({
    temperature: 0.7,
    max_tokens: 4096,
    whisper_model: 'base',
    silence_threshold: 0.01,
    silence_duration: 2.5,
    auto_detect: true,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (config) {
      setForm({
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        whisper_model: config.whisper_model,
        silence_threshold: config.silence_threshold,
        silence_duration: config.silence_duration,
        auto_detect: config.auto_detect,
      })
    }
  }, [config])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.updateConfig(form)
      useInterviewStore.getState().setConfig(await api.getConfig())
      toggleSettings()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!settingsOpen) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={toggleSettings} />
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] bg-bg-secondary z-50 shadow-2xl overflow-y-auto border-l border-bg-tertiary">
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-tertiary">
          <h2 className="text-base font-semibold">设置</h2>
          <button onClick={toggleSettings} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Platform setup guide */}
          {platformInfo?.needs_virtual_device && (
            <div className="bg-accent-amber/10 border border-accent-amber/30 rounded-lg p-3 text-xs space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-accent-amber flex-shrink-0 mt-0.5" />
                <div className="text-text-secondary whitespace-pre-line">{platformInfo.instructions}</div>
              </div>
            </div>
          )}

          {/* STT status */}
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${sttLoaded ? 'bg-accent-green' : sttLoading ? 'bg-accent-amber animate-pulse' : 'bg-accent-red'}`} />
            <span className="text-text-secondary">
              Whisper: {sttLoaded ? '已加载' : sttLoading ? '加载中...' : '未加载'}
            </span>
          </div>

          {config && (
            <div className="bg-bg-tertiary/50 rounded-lg p-3 text-xs space-y-1">
              <p className="text-text-muted">当前模型</p>
              <p className="text-text-primary font-medium">{config.model_name}</p>
              {!config.api_key_set && <p className="text-accent-red">API Key 未配置，请编辑 backend/config.json</p>}
            </div>
          )}

          <Section title="LLM 参数">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Temperature" hint="越高回答越有创意，越低越稳定 (推荐 0.7)">
                <input type="number" step="0.1" min="0" max="2" value={form.temperature}
                  onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })} className="input-field" />
              </Field>
              <Field label="Max Tokens" hint="回答最大长度，面试场景建议 2048-4096">
                <input type="number" step="256" min="256" max="32768" value={form.max_tokens}
                  onChange={(e) => setForm({ ...form, max_tokens: parseInt(e.target.value) })} className="input-field" />
              </Field>
            </div>
            <p className="text-[10px] text-text-muted">模型和 API Key 请在 backend/config.json 中配置</p>
          </Section>

          <Section title="语音识别 (Whisper)">
            <Field label="Whisper 模型" hint="模型越大越准确但速度越慢。base 适合大多数场景">
              <select value={form.whisper_model} onChange={(e) => setForm({ ...form, whisper_model: e.target.value })} className="input-field">
                {(options?.whisper_models ?? ['tiny', 'base', 'small', 'medium']).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
          </Section>

          <Section title="语音活动检测 (VAD)">
            <div className="bg-bg-tertiary/30 rounded-lg p-3 text-xs text-text-muted space-y-1.5 mb-2">
              <div className="flex items-start gap-1.5">
                <HelpCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-accent-blue" />
                <span>VAD 用于判断面试官是否在说话。工作原理：</span>
              </div>
              <ul className="list-disc list-inside pl-5 space-y-0.5">
                <li>持续检测音频音量（能量值）</li>
                <li>音量超过<b>静音阈值</b>→ 认为有人在说话，开始录制</li>
                <li>音量低于阈值且持续超过<b>静音时长</b>→ 认为说完了，发送给 Whisper 转文字</li>
                <li>面试官说话中间的短暂停顿不会中断录制</li>
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="静音阈值" hint="音量低于此值视为静音。环境吵可调高 (0.02-0.05)">
                <input type="number" step="0.005" min="0.001" max="0.1" value={form.silence_threshold}
                  onChange={(e) => setForm({ ...form, silence_threshold: parseFloat(e.target.value) })} className="input-field" />
              </Field>
              <Field label="静音时长 (秒)" hint="连续静音多久才算说完。面试官爱停顿可调大 (3-4秒)">
                <input type="number" step="0.5" min="0.5" max="10" value={form.silence_duration}
                  onChange={(e) => setForm({ ...form, silence_duration: parseFloat(e.target.value) })} className="input-field" />
              </Field>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.auto_detect}
                onChange={(e) => setForm({ ...form, auto_detect: e.target.checked })}
                className="w-4 h-4 rounded bg-bg-tertiary border-bg-hover text-accent-blue focus:ring-accent-blue focus:ring-offset-0" />
              <span className="text-xs text-text-secondary">自动检测问题并生成答案</span>
            </label>
            <p className="text-[10px] text-text-muted pl-6">关闭后仅转录文字，需要手动点击发送才会生成答案</p>
          </Section>

          <button onClick={handleSave} disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>

      <style>{`
        .input-field {
          width: 100%; background: #1a1a24; color: #e2e8f0; font-size: 0.75rem;
          border-radius: 0.5rem; padding: 0.5rem 0.75rem; border: 1px solid #24243a;
          outline: none; transition: border-color 0.15s;
        }
        .input-field:focus { border-color: #6366f1; }
      `}</style>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-text-secondary">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-text-muted leading-tight">{hint}</p>}
    </div>
  )
}
