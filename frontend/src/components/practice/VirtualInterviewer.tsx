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

  const visualStyle = {
    '--vi-skin': spec.palette.skin,
    '--vi-jacket': spec.palette.jacket,
    '--vi-shirt': spec.palette.shirt,
    '--vi-line': spec.palette.line,
    '--vi-accent': spec.palette.accent,
    '--vi-accent-soft': spec.palette.accentSoft,
    '--vi-wave': spec.palette.wave,
    '--vi-eye': spec.palette.eye,
    '--vi-lip': spec.palette.lip,
    '--vi-eye-rx': `${spec.face.eyeRx}`,
    '--vi-eye-ry': `${spec.face.eyeRy}`,
    '--vi-mouth-curve': `${spec.face.mouthCurve}`,
    '--vi-brow-tilt': `${spec.face.browTilt}deg`,
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

        <svg
          className="virtual-interviewer__svg"
          viewBox="0 0 280 340"
          aria-hidden
        >
          <defs>
            <linearGradient id={`vi-face-${spec.key}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.6)" />
              <stop offset="35%" stopColor="var(--vi-skin)" />
              <stop offset="100%" stopColor="rgba(218, 184, 168, 0.88)" />
            </linearGradient>
          </defs>

          <ellipse className="virtual-interviewer__shadow" cx="140" cy="308" rx="84" ry="16" />

          <g className="virtual-interviewer__bust">
            <path
              className="virtual-interviewer__jacket"
              d="M56 306c12-52 46-88 84-88 38 0 72 36 84 88H56Z"
            />
            <path
              className="virtual-interviewer__shirt"
              d="M122 205h36l18 101H104l18-101Z"
            />
            <path
              className="virtual-interviewer__lapel"
              d="M98 222l42 38-25 46H76c2-32 10-58 22-84Z"
            />
            <path
              className="virtual-interviewer__lapel"
              d="M182 222l-42 38 25 46h39c-2-32-10-58-22-84Z"
            />
            <rect className="virtual-interviewer__neck" x="124" y="150" width="32" height="46" rx="16" />
            <circle className="virtual-interviewer__head" cx="140" cy="102" r="62" fill={`url(#vi-face-${spec.key})`} />
            <path
              className="virtual-interviewer__hairline"
              d="M94 94c8-28 30-45 56-45 31 0 54 18 59 47-17-8-34-12-53-12-20 0-41 3-62 10Z"
            />

            <g className="virtual-interviewer__features">
              <path className="virtual-interviewer__brow" d="M107 86c10-6 22-8 34-5" />
              <path className="virtual-interviewer__brow virtual-interviewer__brow--right" d="M173 86c-10-6-22-8-34-5" />

              <g className="virtual-interviewer__eyes">
                <ellipse className="virtual-interviewer__eye" cx="119" cy="101" rx={spec.face.eyeRx} ry={spec.face.eyeRy} />
                <ellipse className="virtual-interviewer__eye" cx="161" cy="101" rx={spec.face.eyeRx} ry={spec.face.eyeRy} />
                <rect className="virtual-interviewer__eyelid" x="108" y="95" width="22" height="12" rx="6" />
                <rect className="virtual-interviewer__eyelid" x="150" y="95" width="22" height="12" rx="6" />
              </g>

              <path className="virtual-interviewer__nose" d="M140 105c4 10 4 19 0 24" />

              <g className="virtual-interviewer__mouths">
                <path className="virtual-interviewer__mouth virtual-interviewer__mouth--rest" d="M120 138c10 9 30 9 40 0" />
                <ellipse className="virtual-interviewer__mouth virtual-interviewer__mouth--speak-a" cx="140" cy="140" rx="15" ry="6.5" />
                <ellipse className="virtual-interviewer__mouth virtual-interviewer__mouth--speak-b" cx="140" cy="140" rx="10" ry="9" />
                <path className="virtual-interviewer__mouth virtual-interviewer__mouth--speak-c" d="M122 136c10 15 26 15 36 0" />
              </g>
            </g>
          </g>
        </svg>

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
