import { useEffect, useState } from 'react'

import type { PracticeVoiceGender } from '@/lib/practiceTts'

const JD_STORAGE_KEY = 'ia-practice-jd-draft'
const VOICE_GENDER_STORAGE_KEY = 'ia-practice-voice-gender'
const VOICE_URI_STORAGE_KEY = 'ia-practice-voice-uri'
const INTERVIEWER_STYLE_STORAGE_KEY = 'ia-practice-interviewer-style'

function readStorage(key: string, fallback = ''): string {
  try {
    return window.localStorage?.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage?.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function usePracticePersistentState() {
  const [jdDraft, setJdDraft] = useState(() => readStorage(JD_STORAGE_KEY))
  const [voiceGender, setVoiceGender] = useState<PracticeVoiceGender>(
    () => (readStorage(VOICE_GENDER_STORAGE_KEY, 'auto') as PracticeVoiceGender) || 'auto',
  )
  const [interviewerStyle, setInterviewerStyle] = useState(
    () => readStorage(INTERVIEWER_STYLE_STORAGE_KEY, 'calm_pressing'),
  )
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => readStorage(VOICE_URI_STORAGE_KEY))

  useEffect(() => {
    writeStorage(JD_STORAGE_KEY, jdDraft)
  }, [jdDraft])

  useEffect(() => {
    writeStorage(VOICE_GENDER_STORAGE_KEY, voiceGender)
  }, [voiceGender])

  useEffect(() => {
    writeStorage(INTERVIEWER_STYLE_STORAGE_KEY, interviewerStyle)
  }, [interviewerStyle])

  useEffect(() => {
    writeStorage(VOICE_URI_STORAGE_KEY, selectedVoiceURI)
  }, [selectedVoiceURI])

  return {
    jdDraft,
    setJdDraft,
    voiceGender,
    setVoiceGender,
    interviewerStyle,
    setInterviewerStyle,
    selectedVoiceURI,
    setSelectedVoiceURI,
  }
}
