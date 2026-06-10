import { useEffect, useState, type CSSProperties, type HTMLAttributes } from 'react'

import clsx from 'clsx'

import { resolveHumanInterviewerAsset } from './humanInterviewerAssets'
import {
  resolveVirtualInterviewerPersona,
  type VirtualInterviewerPersonaKey,
} from './virtualInterviewerPersona'
import {
  getVirtualInterviewerStateLabel,
  IDLE_VIRTUAL_INTERVIEWER_SPEECH_SIGNAL,
  type VirtualInterviewerSpeechSignal,
  type VirtualInterviewerState,
} from './virtualInterviewerState'

export interface VirtualInterviewerProps extends HTMLAttributes<HTMLDivElement> {
  persona: VirtualInterviewerPersonaKey
  state: VirtualInterviewerState
  signal?: string | null
  speechSignal?: VirtualInterviewerSpeechSignal
  subtitle?: string | null
  compact?: boolean
  writtenPromptMode?: boolean
}

type HumanAttentionCue = 'none' | 'ack' | 'focus-left' | 'focus-right' | 'settle'

export function VirtualInterviewer({
  persona,
  state,
  signal,
  speechSignal = IDLE_VIRTUAL_INTERVIEWER_SPEECH_SIGNAL,
  subtitle,
  compact = false,
  writtenPromptMode = false,
  className,
  style,
  ...rest
}: VirtualInterviewerProps) {
  const spec = resolveVirtualInterviewerPersona({ style: persona })
  const asset = resolveHumanInterviewerAsset(spec.key)
  const stateLabel = getVirtualInterviewerStateLabel(state, { writtenPromptMode })
  const renderer = 'human-portrait'
  const speechActive = state === 'speaking' && speechSignal.active
  const waveEnergy = speechActive ? Math.max(0, Math.min(1, speechSignal.energy)) : 0
  const speechCadence = speechActive
    ? Math.max(0, Math.sin((speechSignal.speakingElapsedMs ?? 0) / 170))
    : 0
  const mouthOpen = speechActive
    ? Math.max(0, Math.min(1, speechSignal.mouthOpen * 0.9 + speechCadence * 0.08))
    : 0
  const attentionCue = useHumanAttentionCue(state, compact)
  const liveHeadLift = speechActive ? -(0.18 + waveEnergy * 0.68 + speechCadence * 0.16) : 0
  const liveHeadScale = speechActive ? 0.006 + waveEnergy * 0.012 + speechCadence * 0.004 : 0
  const mouthPlateScaleX = 1 - mouthOpen * 0.045
  const mouthPlateScaleY = 1 + mouthOpen * 0.24
  const mouthPlateLift = speechActive ? -(0.08 + mouthOpen * 0.5) : 0
  const mouthClipX = 12.2 + mouthOpen * 4.6
  const mouthClipY = 5.4 + mouthOpen * 3.4

  const visualStyle = {
    '--vi-line': spec.palette.line,
    '--vi-accent': spec.palette.accent,
    '--vi-accent-soft': spec.palette.accentSoft,
    '--vi-wave': spec.palette.wave,
    '--vi-speech-energy': `${waveEnergy}`,
    '--vi-mouth-open': `${mouthOpen}`,
    '--vi-live-head-lift': `${liveHeadLift.toFixed(3)}%`,
    '--vi-live-head-scale': `${liveHeadScale.toFixed(3)}`,
    '--vi-mouth-plate-scale-x': `${mouthPlateScaleX.toFixed(3)}`,
    '--vi-mouth-plate-scale-y': `${mouthPlateScaleY.toFixed(3)}`,
    '--vi-mouth-plate-lift': `${mouthPlateLift.toFixed(3)}%`,
    '--vi-mouth-clip-x': `${mouthClipX.toFixed(2)}%`,
    '--vi-mouth-clip-y': `${mouthClipY.toFixed(2)}%`,
    '--vi-portrait-position': asset.objectPosition,
    '--vi-mouth-x': asset.mouthX,
    '--vi-mouth-y': asset.mouthY,
    '--vi-gaze-x': asset.gazeX,
    '--vi-gaze-y': asset.gazeY,
    '--vi-warmth': asset.warmth,
    ...style,
  } as CSSProperties

  return (
    <div
      {...rest}
      role="img"
      aria-label={`${spec.fullLabel}，${stateLabel}`}
      data-persona={spec.key}
      data-state={state}
      data-signal={signal ?? 'neutral'}
      data-renderer={renderer}
      data-speech-active={speechActive ? 'true' : 'false'}
      data-attention-cue={attentionCue}
      className={clsx(
        'virtual-interviewer',
        compact && 'virtual-interviewer--compact',
        className,
      )}
      style={visualStyle}
    >
      <div className="virtual-interviewer__stage">
        <div className="virtual-interviewer__aura" aria-hidden />
        <div className="virtual-interviewer__pulse" aria-hidden />
        <div className="virtual-interviewer__scan" aria-hidden />

        <div
          className="virtual-interviewer__portrait-shell"
          data-testid="virtual-interviewer-human-portrait"
          aria-hidden
        >
          <div className="virtual-interviewer__human-layer">
            <img
              className="virtual-interviewer__portrait-img"
              src={asset.src}
              alt=""
              onError={(event) => {
                const image = event.currentTarget
                image.dataset.assetMissing = 'true'
                image.removeAttribute('src')
              }}
            />
            <img
              className="virtual-interviewer__mouth-plate"
              src={asset.src}
              alt=""
            />
            <span className="virtual-interviewer__asset-placeholder">
              待生成
            </span>
            <span className="virtual-interviewer__collar-breath" />
            <span className="virtual-interviewer__cheek-warmth" />
            <span className="virtual-interviewer__face-light" />
            <span className="virtual-interviewer__eye-focus" />
            <span className="virtual-interviewer__eye-catchlights" />
            <span className="virtual-interviewer__gaze-glint" />
            <span className="virtual-interviewer__blink" />
            <span className="virtual-interviewer__jaw-shadow" />
            <span className="virtual-interviewer__mouth-cue" />
          </div>
        </div>

        <div className="virtual-interviewer__wave" aria-hidden>
          {[0.35, 0.55, 0.8, 1, 0.8, 0.55, 0.35].map((size, index) => (
            <span
              key={index}
              className="virtual-interviewer__wave-bar"
              style={{
                '--vi-wave-scale': `${
                  speechActive
                    ? Math.max(0.22, Math.min(1.65, size * (0.42 + waveEnergy * 1.6)))
                    : size
                }`,
                '--vi-wave-index': `${index}`,
              } as CSSProperties}
            />
          ))}
        </div>
      </div>

      {subtitle ? (
        <div className="virtual-interviewer__subtitle" aria-live="polite">
          {subtitle}
        </div>
      ) : null}
    </div>
  )
}

function useHumanAttentionCue(
  state: VirtualInterviewerState,
  compact: boolean,
): HumanAttentionCue {
  const [cue, setCue] = useState<HumanAttentionCue>('none')

  useEffect(() => {
    if (compact || state === 'debrief' || typeof window === 'undefined') {
      setCue('none')
      return
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setCue('none')
      return
    }

    let cancelled = false
    let cueTimer: number | undefined
    let resetTimer: number | undefined

    const cuesByState: Record<VirtualInterviewerState, HumanAttentionCue[]> = {
      speaking: ['settle', 'focus-left', 'focus-right'],
      listening: ['ack', 'focus-left', 'focus-right'],
      thinking: ['focus-left', 'focus-right', 'settle'],
      idle: ['focus-left', 'focus-right'],
      debrief: ['none'],
    }

    const baseDelayByState: Record<VirtualInterviewerState, number> = {
      speaking: 2800,
      listening: 2100,
      thinking: 1800,
      idle: 4200,
      debrief: 0,
    }

    const firstDelayByState: Record<VirtualInterviewerState, number> = {
      speaking: 940,
      listening: 720,
      thinking: 860,
      idle: 1500,
      debrief: 0,
    }

    const firstCueByState: Record<VirtualInterviewerState, HumanAttentionCue> = {
      speaking: 'settle',
      listening: 'ack',
      thinking: 'focus-left',
      idle: 'focus-right',
      debrief: 'none',
    }

    const cueDuration = (next: HumanAttentionCue) => {
      if (next === 'ack') return 960
      if (next === 'settle') return 760
      if (next === 'none') return 0
      return 720
    }

    let cycle = 0

    const schedule = () => {
      const firstCycle = cycle === 0
      const baseDelay = firstCycle
        ? firstDelayByState[state] ?? 900
        : baseDelayByState[state] ?? 2600
      cycle += 1
      cueTimer = window.setTimeout(() => {
        if (cancelled) return
        const options = cuesByState[state] ?? cuesByState.idle
        const next = firstCycle
          ? firstCueByState[state] ?? 'none'
          : options[Math.floor(Math.random() * options.length)] ?? 'none'
        setCue(next)
        resetTimer = window.setTimeout(() => {
          if (cancelled) return
          setCue('none')
          schedule()
        }, cueDuration(next))
      }, baseDelay + (firstCycle ? 0 : Math.random() * 1800))
    }

    schedule()

    return () => {
      cancelled = true
      if (cueTimer != null) window.clearTimeout(cueTimer)
      if (resetTimer != null) window.clearTimeout(resetTimer)
      setCue('none')
    }
  }, [compact, state])

  return cue
}
