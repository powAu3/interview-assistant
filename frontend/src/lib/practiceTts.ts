import practiceTtsTermsData from '../../../shared/practice_tts_terms.json'

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
  onAudio?: (audio: HTMLAudioElement) => void
  signal?: AbortSignal
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

interface PracticeTtsTermsData {
  common: Array<[string, string]>
  zh: Array<[string, string]>
  en: Array<[string, string]>
}

const PRACTICE_TTS_TERMS = practiceTtsTermsData as PracticeTtsTermsData

function includesAny(name: string, hints: string[]): boolean {
  const lower = name.toLowerCase()
  return hints.some((hint) => lower.includes(hint))
}

export function normalizePracticeTtsText(text: string, localeHint = 'zh'): string {
  let normalized = String(text || '').trim()
  const replacements = [
    ...PRACTICE_TTS_TERMS.common,
    ...(localeHint.toLowerCase().startsWith('en') ? PRACTICE_TTS_TERMS.en : PRACTICE_TTS_TERMS.zh),
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
  if (options.signal?.aborted) return false
  return new Promise<boolean>((resolve) => {
    const audio = new Audio(`data:${options.contentType};base64,${options.audioBase64}`)
    let settled = false
    const settle = (value: boolean) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abortPlayback)
      resolve(value)
    }
    const abortPlayback = () => {
      try {
        audio.pause()
        audio.removeAttribute('src')
      } catch {
        /* ignore */
      }
      settle(false)
    }

    options.onAudio?.(audio)
    options.signal?.addEventListener('abort', abortPlayback, { once: true })
    audio.onplay = () => {
      if (options.signal?.aborted) {
        abortPlayback()
        return
      }
      options.onStart?.()
    }
    audio.onended = () => {
      if (options.signal?.aborted) {
        abortPlayback()
        return
      }
      options.onEnd?.()
      settle(true)
    }
    audio.onerror = () => {
      options.onError?.('云端语音播报失败，已降级为本地语音')
      settle(false)
    }
    audio
      .play()
      .then(() => undefined)
      .catch(() => {
        options.onError?.('云端语音播报失败，已降级为本地语音')
        settle(false)
      })
  })
}
