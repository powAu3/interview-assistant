export type PracticeVoiceGender = 'auto' | 'female' | 'male'
export interface PracticeVoiceLike {
  voiceURI: string
  name: string
  lang: string
}

interface PickVoiceOptions {
  preferredGender: PracticeVoiceGender
  selectedVoiceURI: string
}

interface SpeakOptions extends PickVoiceOptions {
  text: string
  synthesis?: SpeechSynthesis
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

interface RemoteSpeakOptions {
  audioBase64: string
  contentType: string
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

const FEMALE_HINTS = [
  'female',
  'woman',
  'girl',
  'xiaoxiao',
  'xiaoyi',
  'xiaomeng',
  'anna',
  'amy',
  'flo',
  'grandma',
  'meijia',
]

const MALE_HINTS = [
  'male',
  'man',
  'boy',
  'yunyi',
  'yunze',
  'yunxia',
  'martin',
  'james',
  'evan',
  'eddy',
  'reed',
  'grandpa',
]

const COMMON_TERM_REPLACEMENTS: Array<[string, string]> = [
  ['PostgreSQL', 'Postgres sequel'],
  ['MySQL', 'My sequel'],
  ['SQL', 'sequel'],
  ['JVM', 'J V M'],
  ['API', 'A P I'],
  ['SDK', 'S D K'],
  ['HTTP', 'H T T P'],
  ['HTTPS', 'H T T P S'],
  ['TCP', 'T C P'],
  ['UDP', 'U D P'],
  ['RPC', 'R P C'],
  ['gRPC', 'G R P C'],
  ['JWT', 'J W T'],
  ['JSON', 'J S O N'],
  ['YAML', 'Y A M L'],
  ['CDN', 'C D N'],
  ['DNS', 'D N S'],
]

const ZH_TERM_REPLACEMENTS: Array<[string, string]> = [
  ['Redis', 'Ree dis'],
  ['Kafka', 'Kaf ka'],
  ['Nginx', 'Engine X'],
  ['Linux', 'Linucks'],
  ['MongoDB', 'Mongo D B'],
  ['RabbitMQ', 'Rabbit M Q'],
  ['Elasticsearch', 'Elastic Search'],
  ['OpenTelemetry', 'Open Telemetry'],
  ['ClickHouse', 'Click House'],
  ['Prometheus', 'Prometheus'],
  ['Grafana', 'Grafana'],
  ['Kubernetes', 'Kuber net ease'],
  ['TypeScript', 'Type Script'],
  ['JavaScript', 'Java Script'],
  ['OAuth', 'Oh Auth'],
]

const EN_TERM_REPLACEMENTS: Array<[string, string]> = [
  ['ClickHouse', 'Click House'],
  ['OpenTelemetry', 'Open Telemetry'],
  ['RabbitMQ', 'Rabbit M Q'],
  ['MongoDB', 'Mongo D B'],
  ['Nginx', 'Engine X'],
  ['OAuth', 'Oh Auth'],
]

function includesAny(name: string, hints: string[]): boolean {
  const lower = name.toLowerCase()
  return hints.some((hint) => lower.includes(hint))
}

export function normalizePracticeTtsText(text: string, localeHint = 'zh'): string {
  let normalized = String(text || '').trim()
  const replacements = [
    ...COMMON_TERM_REPLACEMENTS,
    ...(localeHint.toLowerCase().startsWith('en') ? EN_TERM_REPLACEMENTS : ZH_TERM_REPLACEMENTS),
  ]
  for (const [source, target] of replacements) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    normalized = normalized.replace(
      new RegExp(`(^|[^A-Za-z])(${escaped})(?=[^A-Za-z]|$)`, 'g'),
      (_, prefix: string) => `${prefix}${target}`,
    )
  }
  return normalized
}

export function pickPreferredVoice(
  voices: PracticeVoiceLike[],
  options: PickVoiceOptions,
): PracticeVoiceLike | null {
  const selected = voices.find((voice) => voice.voiceURI === options.selectedVoiceURI)
  if (selected) return selected

  const zhVoices = voices.filter((voice) => voice.lang?.toLowerCase().startsWith('zh'))
  const pool = zhVoices.length > 0 ? zhVoices : voices
  if (pool.length === 0) return null

  if (options.preferredGender === 'female') {
    return pool.find((voice) => includesAny(voice.name, FEMALE_HINTS)) ?? pool[0]
  }
  if (options.preferredGender === 'male') {
    return pool.find((voice) => includesAny(voice.name, MALE_HINTS)) ?? pool[0]
  }
  return pool[0]
}

export async function speakWithBrowserTts(options: SpeakOptions): Promise<boolean> {
  const synthesis = options.synthesis
  if (!synthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    options.onError?.('当前环境不支持浏览器语音播报')
    return false
  }

  const voices = synthesis.getVoices?.() ?? []
  const voice = pickPreferredVoice(voices, options) as SpeechSynthesisVoice | null

  return new Promise<boolean>((resolve) => {
    const localeHint = voice?.lang || 'zh-CN'
    const utterance = new SpeechSynthesisUtterance(normalizePracticeTtsText(options.text, localeHint))
    utterance.lang = voice?.lang || 'zh-CN'
    if (voice) utterance.voice = voice
    utterance.rate = 1
    utterance.pitch = 1

    utterance.onstart = () => {
      options.onStart?.()
    }
    utterance.onend = () => {
      options.onEnd?.()
      resolve(true)
    }
    utterance.onerror = () => {
      options.onError?.('浏览器语音播报失败，已降级为静默文本')
      resolve(false)
    }

    try {
      synthesis.cancel()
      synthesis.speak(utterance)
    } catch {
      options.onError?.('浏览器语音播报失败，已降级为静默文本')
      resolve(false)
    }
  })
}

export async function playBase64Audio(options: RemoteSpeakOptions): Promise<boolean> {
  if (typeof Audio === 'undefined') {
    options.onError?.('当前环境不支持音频播放')
    return false
  }
  return new Promise<boolean>((resolve) => {
    const audio = new Audio(`data:${options.contentType};base64,${options.audioBase64}`)
    audio.onplay = () => options.onStart?.()
    audio.onended = () => {
      options.onEnd?.()
      resolve(true)
    }
    audio.onerror = () => {
      options.onError?.('云端语音播报失败，已降级为本地语音')
      resolve(false)
    }
    audio
      .play()
      .then(() => undefined)
      .catch(() => {
        options.onError?.('云端语音播报失败，已降级为本地语音')
        resolve(false)
      })
  })
}
