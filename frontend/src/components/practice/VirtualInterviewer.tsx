import { type CSSProperties, type HTMLAttributes } from 'react'

import clsx from 'clsx'

import { RocketboxStage } from './RocketboxStage'
import { ROCKETBOX_POSTER_PATH } from './rocketboxAssets'
import {
  resolveVirtualInterviewerPersona,
  type VirtualInterviewerPersonaKey,
} from './virtualInterviewerPersona'
import {
  getVirtualInterviewerStateLabel,
  type VirtualInterviewerState,
} from './virtualInterviewerState'

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
  const renderer = compact ? 'rocketbox-poster' : 'rocketbox-three'

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
      data-renderer={renderer}
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

        {compact ? (
          <div
            className="virtual-interviewer__rocketbox-poster"
            data-testid="virtual-interviewer-rocketbox-poster"
            aria-hidden
          >
            <img src={ROCKETBOX_POSTER_PATH} alt="" />
          </div>
        ) : (
          <RocketboxStage state={state} />
        )}

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
