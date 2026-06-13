import type { VirtualInterviewerPersonaKey } from './virtualInterviewerPersona'

export type HumanInterviewerVoiceGender = 'female' | 'male'

export interface HumanInterviewerAsset {
  src: string
  objectPosition: string
  mouthX: string
  mouthY: string
  gazeX: string
  gazeY: string
  warmth: string
  voiceGender: HumanInterviewerVoiceGender
}

const HUMAN_INTERVIEWER_ASSETS: Record<VirtualInterviewerPersonaKey, HumanInterviewerAsset> = {
  calm_pressing: {
    src: '/avatars/generated/interviewer-calm-v2.png',
    objectPosition: '50% 7%',
    mouthX: '50%',
    mouthY: '47%',
    gazeX: '50%',
    gazeY: '31%',
    warmth: '0.34',
    voiceGender: 'male',
  },
  supportive_senior: {
    src: '/avatars/generated/interviewer-supportive-v2.png',
    objectPosition: '50% 8%',
    mouthX: '50%',
    mouthY: '48%',
    gazeX: '50%',
    gazeY: '32%',
    warmth: '0.48',
    voiceGender: 'male',
  },
  pressure_bigtech: {
    src: '/avatars/generated/interviewer-pressure-v2.png',
    objectPosition: '50% 6%',
    mouthX: '50%',
    mouthY: '47%',
    gazeX: '50%',
    gazeY: '30%',
    warmth: '0.24',
    voiceGender: 'male',
  },
}

export function resolveHumanInterviewerAsset(
  persona: VirtualInterviewerPersonaKey,
): HumanInterviewerAsset {
  return HUMAN_INTERVIEWER_ASSETS[persona] ?? HUMAN_INTERVIEWER_ASSETS.calm_pressing
}
