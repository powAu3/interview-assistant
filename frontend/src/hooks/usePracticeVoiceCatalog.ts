import { useEffect, useMemo, useState } from 'react'

import {
  pickPreferredVoice,
  type PracticeVoiceGender,
  type PracticeVoiceLike,
} from '@/lib/practiceTts'
import {
  resolveVirtualInterviewerPersona,
  VIRTUAL_INTERVIEWER_PERSONA_OPTIONS as INTERVIEWER_STYLE_OPTIONS,
} from '@/components/practice/virtualInterviewerPersona'

export type BrowserVoice = PracticeVoiceLike & {
  source?: string
  genderHint?: string
}

interface UsePracticeVoiceCatalogArgs {
  config?: {
    practice_tts_provider?: string
  } | null
  interviewerStyle: string
  selectedVoiceURI: string
  voiceGender: PracticeVoiceGender
  practiceSession?: {
    interviewer_persona?: { tone?: string } | null
    context?: { interviewer_style?: string } | null
  } | null
}

export function usePracticeVoiceCatalog(args: UsePracticeVoiceCatalogArgs) {
  const [voices, setVoices] = useState<BrowserVoice[]>([])
  const useEdgeTts = (args.config?.practice_tts_provider ?? 'edge_tts') === 'edge_tts'
  const selectedDesktopVoice = args.selectedVoiceURI.startsWith('say:')
    ? args.selectedVoiceURI.replace(/^say:/, '')
    : ''

  const autoPreferredLocalVoice = useMemo(
    () => pickPreferredVoice(voices, {
      preferredGender: args.voiceGender,
      selectedVoiceURI: args.selectedVoiceURI,
    }) ?? null,
    [args.selectedVoiceURI, args.voiceGender, voices],
  )

  const resolvedDesktopVoiceName =
    selectedDesktopVoice
    || (autoPreferredLocalVoice?.voiceURI.startsWith('say:')
      ? autoPreferredLocalVoice.voiceURI.replace(/^say:/, '')
      : '')

  const selectedPersona = resolveVirtualInterviewerPersona({ style: args.interviewerStyle })
  const activePersona = resolveVirtualInterviewerPersona({
    tone: args.practiceSession?.interviewer_persona?.tone,
    style: args.practiceSession?.context?.interviewer_style ?? args.interviewerStyle,
  })

  useEffect(() => {
    const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined
    const loadDesktopVoices = async () => {
      try {
        const systemVoices = await window.electronAPI?.listSystemTtsVoices?.()
        if (systemVoices && systemVoices.length > 0) {
          setVoices(systemVoices)
          return true
        }
      } catch {
        /* ignore */
      }
      return false
    }

    void loadDesktopVoices().then((usedDesktop) => {
      if (usedDesktop || !synthesis) return
      const syncVoices = () => {
        const next = synthesis.getVoices().map((voice) => ({
          voiceURI: voice.voiceURI,
          name: voice.name,
          lang: voice.lang,
        }))
        setVoices(next)
      }

      syncVoices()
      synthesis.addEventListener?.('voiceschanged', syncVoices)
    })
    if (!synthesis) return
    const syncVoices = () => {
      const next = synthesis.getVoices().map((voice) => ({
        voiceURI: voice.voiceURI,
        name: voice.name,
        lang: voice.lang,
      }))
      setVoices((current) => (current.length > 0 ? current : next))
    }
    return () => synthesis.removeEventListener?.('voiceschanged', syncVoices)
  }, [])

  return {
    voices,
    useEdgeTts,
    autoPreferredLocalVoice,
    resolvedDesktopVoiceName,
    selectedPersona,
    activePersona,
    interviewerStyleOptions: INTERVIEWER_STYLE_OPTIONS,
  }
}
