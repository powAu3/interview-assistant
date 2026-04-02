import { useState } from 'react'
import { HelpCircle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'

const STT_GUIDES: Record<string, { color: string; borderColor: string; title: string; steps: string[]; link?: { url: string; label: string } }> = {
  whisper: {
    color: 'bg-sky-500/10',
    borderColor: 'border-sky-500/20',
    title: 'Whisper 本地引擎',
    steps: [
      '无需密钥，完全在本机运行',
      '首次使用会自动下载模型（base ≈ 150MB）',
      '模型越大越准但越慢，推荐 base 或 small',
      '需确保 Python 环境已安装 faster-whisper',
    ],
  },
  doubao: {
    color: 'bg-orange-500/10',
    borderColor: 'border-orange-500/20',
    title: '豆包（火山引擎）',
    steps: [
      '前往火山引擎控制台 → 语音技术 → 流式语音识别',
      '创建应用，获取 App ID 和 Access Token',
      'Resource ID 默认为流式语音识别 2.0 小时版',
      '可选：上传热词表文件获取 Boosting Table ID',
    ],
    link: { url: 'https://console.volcengine.com/speech/service/8', label: '火山引擎控制台' },
  },
  iflytek: {
    color: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    title: '讯飞（语音听写）',
    steps: [
      '前往讯飞开放平台 → 控制台 → 创建应用',
      '在应用管理中获取 APPID、APIKey、APISecret',
      '开通「语音听写（流式版）」服务',
      '每日有免费调用额度，超出需付费',
    ],
    link: { url: 'https://console.xfyun.cn/services/iat', label: '讯飞开放平台' },
  },
}

export default function SttGuideCard({ provider }: { provider: string }) {
  const [open, setOpen] = useState(false)
  const guide = STT_GUIDES[provider]
  if (!guide) return null
  return (
    <div className={`rounded-xl border ${guide.borderColor} ${guide.color} overflow-hidden transition-all duration-200`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-medium text-text-primary">
          <HelpCircle className="w-3.5 h-3.5 text-text-muted" />
          {guide.title} — 配置指引
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-text-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-text-muted" />}
      </button>
      <div className={`grid transition-all duration-200 ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="px-4 pb-4 space-y-2">
            <ol className="space-y-1.5 text-xs text-text-secondary list-decimal pl-4">
              {guide.steps.map((s, i) => <li key={i} className="leading-relaxed">{s}</li>)}
            </ol>
            {guide.link && (
              <a
                href={guide.link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent-blue hover:underline mt-1"
              >
                <ExternalLink className="w-3 h-3" />
                {guide.link.label}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
