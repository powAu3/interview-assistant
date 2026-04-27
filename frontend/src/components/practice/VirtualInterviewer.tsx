import type { CSSProperties, HTMLAttributes } from 'react'

import clsx from 'clsx'

import {
  resolveVirtualInterviewerPersona,
  type VirtualInterviewerPersonaKey,
} from './virtualInterviewerPersona'
import {
  getVirtualInterviewerStateLabel,
  type VirtualInterviewerState,
} from './virtualInterviewerState'

const PORTRAIT_BY_PERSONA: Record<VirtualInterviewerPersonaKey, string> = {
  calm_pressing: new URL(
    '../../assets/virtual-interviewers/open-peeps-calm.svg',
    import.meta.url,
  ).href,
  supportive_senior: new URL(
    '../../assets/virtual-interviewers/open-peeps-supportive.svg',
    import.meta.url,
  ).href,
  pressure_bigtech: new URL(
    '../../assets/virtual-interviewers/open-peeps-pressure.svg',
    import.meta.url,
  ).href,
}

export interface VirtualInterviewerProps extends HTMLAttributes<HTMLDivElement> {
  persona: VirtualInterviewerPersonaKey
  state: VirtualInterviewerState
  signal?: string | null
  subtitle?: string | null
  compact?: boolean
  writtenPromptMode?: boolean
}

export function VirtualInterviewer({
  persona,
  state,
  signal,
  subtitle,
  compact = false,
  writtenPromptMode = false,
  className,
  style,
  ...rest
}: VirtualInterviewerProps) {
  const spec = resolveVirtualInterviewerPersona({ style: persona })
  const stateLabel = getVirtualInterviewerStateLabel(state, { writtenPromptMode })
  const portraitSrc = PORTRAIT_BY_PERSONA[spec.key]

  const visualStyle = {
    '--vi-line': spec.palette.line,
    '--vi-accent': spec.palette.accent,
    '--vi-accent-soft': spec.palette.accentSoft,
    '--vi-wave': spec.palette.wave,
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
          className="virtual-interviewer__portrait-frame"
          data-testid="virtual-interviewer-portrait-frame"
          aria-hidden
        >
          <img
            className="virtual-interviewer__portrait"
            data-testid="virtual-interviewer-portrait"
            src={portraitSrc}
            alt=""
            draggable={false}
          />
        </div>

        <div className="virtual-interviewer__wave" aria-hidden>
          {[0.35, 0.55, 0.8, 1, 0.8, 0.55, 0.35].map((size, index) => (
            <span
              key={index}
              className="virtual-interviewer__wave-bar"
              style={{ '--vi-wave-scale': `${size}`, '--vi-wave-index': `${index}` } as CSSProperties}
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
