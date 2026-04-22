export type VirtualInterviewerPersonaKey =
  | 'calm_pressing'
  | 'supportive_senior'
  | 'pressure_bigtech'

export interface VirtualInterviewerPersonaSpec {
  key: VirtualInterviewerPersonaKey
  tone: string
  label: string
  fullLabel: string
  hint: string
  summary: string
  description: string
  projectBias: string
  barRule: string
  palette: {
    skin: string
    jacket: string
    shirt: string
    line: string
    accent: string
    accentSoft: string
    wave: string
    eye: string
    lip: string
  }
  face: {
    eyeRx: number
    eyeRy: number
    mouthCurve: number
    browTilt: number
  }
}

const PERSONAS: Record<VirtualInterviewerPersonaKey, VirtualInterviewerPersonaSpec> = {
  calm_pressing: {
    key: 'calm_pressing',
    tone: 'calm-pressing',
    label: '稳压型',
    fullLabel: '稳压型面试官',
    hint: '礼貌但不放水，像常规技术一面。',
    summary: '冷静、克制、审视感更强。',
    description: '像国内一线技术面试官，礼貌但不放水，会追问证据、取舍和复盘。',
    projectBias: '项目题优先追 why / how / validation，不让候选人停在结果层。',
    barRule: '回答一旦缺少证据、边界或实现，就优先追问而不是轻易放过。',
    palette: {
      skin: '#f0cfbe',
      jacket: '#17283b',
      shirt: '#f7f0e3',
      line: '#18314b',
      accent: '#c77445',
      accentSoft: 'rgba(199, 116, 69, 0.18)',
      wave: '#cd7b4d',
      eye: '#15293f',
      lip: '#884c42',
    },
    face: {
      eyeRx: 7.6,
      eyeRy: 3.8,
      mouthCurve: 4,
      browTilt: -2,
    },
  },
  supportive_senior: {
    key: 'supportive_senior',
    tone: 'supportive-senior',
    label: '带教型',
    fullLabel: '带教型面试官',
    hint: '更温和，会帮你起主线，但仍然追细节。',
    summary: '更温和，带一点引导感。',
    description: '像愿意带人的资深面试官，语气温和，但会用结构化追问逼你把能力讲实。',
    projectBias: '项目题先帮候选人立主线，再追细节和复盘。',
    barRule: '先让候选人把答案讲完整，再逐步抬高追问强度。',
    palette: {
      skin: '#efcfbf',
      jacket: '#21415a',
      shirt: '#f9f3e8',
      line: '#18314b',
      accent: '#cf9b5d',
      accentSoft: 'rgba(207, 155, 93, 0.2)',
      wave: '#e0ad67',
      eye: '#17314c',
      lip: '#9f6159',
    },
    face: {
      eyeRx: 8.2,
      eyeRy: 4.1,
      mouthCurve: 7,
      browTilt: -5,
    },
  },
  pressure_bigtech: {
    key: 'pressure_bigtech',
    tone: 'pressure-bigtech',
    label: '压力型',
    fullLabel: '压力型面试官',
    hint: '切题更快、追问更尖，偏大厂技术面。',
    summary: '更锐利，压迫感更强。',
    description: '像大厂技术面，切题更快、追问更锋利，优先盯风险、边界和实现细节。',
    projectBias: '项目题默认追最难的取舍和线上失误，不接受泛泛而谈。',
    barRule: '只要回答不够硬，就立刻追加更尖锐的问题。',
    palette: {
      skin: '#e9c7b6',
      jacket: '#111f31',
      shirt: '#f6eddf',
      line: '#101f31',
      accent: '#b85a37',
      accentSoft: 'rgba(184, 90, 55, 0.2)',
      wave: '#cf6342',
      eye: '#0f2033',
      lip: '#7f3e34',
    },
    face: {
      eyeRx: 7.1,
      eyeRy: 3.3,
      mouthCurve: 1.5,
      browTilt: 5,
    },
  },
}

const TONE_TO_PERSONA: Record<string, VirtualInterviewerPersonaKey> = {
  'calm-pressing': 'calm_pressing',
  'supportive-senior': 'supportive_senior',
  'pressure-bigtech': 'pressure_bigtech',
}

export const VIRTUAL_INTERVIEWER_PERSONA_OPTIONS = (
  Object.values(PERSONAS) as VirtualInterviewerPersonaSpec[]
).map((persona) => ({
  value: persona.key,
  label: persona.label,
  hint: persona.hint,
  summary: persona.summary,
}))

export function normalizeVirtualInterviewerPersona(
  value?: string | null,
): VirtualInterviewerPersonaKey {
  if (!value) return 'calm_pressing'
  if (value in PERSONAS) return value as VirtualInterviewerPersonaKey
  if (value in TONE_TO_PERSONA) return TONE_TO_PERSONA[value]
  return 'calm_pressing'
}

export function resolveVirtualInterviewerPersona(input?: {
  style?: string | null
  tone?: string | null
}) {
  const key = normalizeVirtualInterviewerPersona(input?.tone ?? input?.style)
  return PERSONAS[key]
}
