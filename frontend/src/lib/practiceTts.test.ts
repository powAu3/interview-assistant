import { describe, expect, it, vi } from 'vitest'

import { normalizePracticeTtsText, pickPreferredVoice, speakWithBrowserTts } from './practiceTts'

function makeVoice(overrides: Partial<SpeechSynthesisVoice>): SpeechSynthesisVoice {
  return {
    default: false,
    lang: 'zh-CN',
    localService: true,
    name: 'Voice',
    voiceURI: 'voice-uri',
    ...overrides,
  } as SpeechSynthesisVoice
}

describe('practiceTts', () => {
  it('prefers an explicitly selected voice uri when available', () => {
    const voices = [
      makeVoice({ name: 'Female Voice', voiceURI: 'female-1' }),
      makeVoice({ name: 'Male Voice', voiceURI: 'male-1' }),
    ]

    const picked = pickPreferredVoice(voices, {
      preferredGender: 'female',
      selectedVoiceURI: 'male-1',
    })

    expect(picked?.voiceURI).toBe('male-1')
  })

  it('falls back to zh female / male heuristics when no explicit uri is selected', () => {
    const voices = [
      makeVoice({ name: 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)', voiceURI: 'female' }),
      makeVoice({ name: 'Microsoft Yunyi Online (Natural) - Chinese (Mainland)', voiceURI: 'male' }),
    ]

    expect(
      pickPreferredVoice(voices, { preferredGender: 'female', selectedVoiceURI: '' })?.voiceURI,
    ).toBe('female')
    expect(
      pickPreferredVoice(voices, { preferredGender: 'male', selectedVoiceURI: '' })?.voiceURI,
    ).toBe('male')
  })

  it('can auto-pick macOS say voices by gender hint in the voice name', () => {
    const voices = [
      makeVoice({ name: 'Grandma (中文（中国大陆）)', voiceURI: 'say:Grandma', lang: 'zh-CN' }),
      makeVoice({ name: 'Grandpa (中文（中国大陆）)', voiceURI: 'say:Grandpa', lang: 'zh-CN' }),
    ]

    expect(
      pickPreferredVoice(voices, { preferredGender: 'female', selectedVoiceURI: '' })?.voiceURI,
    ).toBe('say:Grandma')
    expect(
      pickPreferredVoice(voices, { preferredGender: 'male', selectedVoiceURI: '' })?.voiceURI,
    ).toBe('say:Grandpa')
  })

  it('returns false when browser speech synthesis is unavailable', async () => {
    const onError = vi.fn()

    const ok = await speakWithBrowserTts({
      text: '介绍一下你自己。',
      synthesis: undefined,
      preferredGender: 'female',
      selectedVoiceURI: '',
      onError,
    })

    expect(ok).toBe(false)
    expect(onError).toHaveBeenCalled()
  })

  it('normalizes SQL-like terms into more natural TTS pronunciations', () => {
    const normalized = normalizePracticeTtsText('请讲一下 MySQL、PostgreSQL 和 SQL，再说说 Redis。')

    expect(normalized).toContain('My sequel')
    expect(normalized).toContain('Postgres sequel')
    expect(normalized).toContain('sequel')
    expect(normalized).toContain('Ree dis')
  })

  it('normalizes english backend terms for clearer TTS output', () => {
    const normalized = normalizePracticeTtsText(
      'Explain Redis, API gateway, SDK retry, JSON payload, YAML config, and OAuth.',
      'en-US',
    )

    expect(normalized).toContain('A P I')
    expect(normalized).toContain('S D K')
    expect(normalized).toContain('J S O N')
    expect(normalized).toContain('Y A M L')
    expect(normalized).toContain('Oh Auth')
  })
})
