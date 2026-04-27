import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from 'react'

import clsx from 'clsx'

import {
  resolveVirtualInterviewerPersona,
  type VirtualInterviewerPersonaKey,
} from './virtualInterviewerPersona'
import {
  getVirtualInterviewerStateLabel,
  type VirtualInterviewerState,
} from './virtualInterviewerState'

const LIVE2D_MODEL_PATH = '/live2d/Natori/Natori.model3.json'
const LIVE2D_BASE_WIDTH = 137
const LIVE2D_BASE_HEIGHT = 175
const LIVE2D_BASE_SCALE = 0.052

type Live2DLoadStatus = 'loading' | 'ready' | 'fallback'
type Live2DInstance = {
  clearTips?: () => void
  onLoad?: (fn: (status: 'loading' | 'success' | 'fail') => void) => void
  setModelPosition?: (position: { x?: number; y?: number }) => void
  setModelScale?: (scale: number) => void
  stageSlideOut?: () => Promise<void>
}

function canRenderLive2D() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (!('WebGLRenderingContext' in window)) return false
  const canvas = document.createElement('canvas')
  return Boolean(
    canvas.getContext('webgl') || canvas.getContext('experimental-webgl'),
  )
}

function fitLive2DModel(live2d: Live2DInstance, parentElement: HTMLElement) {
  const rect = parentElement.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return

  const stageRatio = Math.min(
    rect.width / LIVE2D_BASE_WIDTH,
    rect.height / LIVE2D_BASE_HEIGHT,
  )
  live2d.setModelScale?.(LIVE2D_BASE_SCALE * stageRatio)
  live2d.setModelPosition?.({
    x: rect.width * 0.5,
    y: rect.height * 0.503,
  })
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
  const live2dStageRef = useRef<HTMLDivElement | null>(null)
  const live2dInstanceRef = useRef<Live2DInstance | null>(null)
  const [live2dStatus, setLive2dStatus] = useState<Live2DLoadStatus>('loading')
  const renderer = compact ? 'compact-2d' : 'live2d'

  const visualStyle = {
    '--vi-line': spec.palette.line,
    '--vi-accent': spec.palette.accent,
    '--vi-accent-soft': spec.palette.accentSoft,
    '--vi-wave': spec.palette.wave,
    ...style,
  } as CSSProperties

  useEffect(() => {
    if (compact) return
    const parentElement = live2dStageRef.current
    if (!parentElement) return

    parentElement.innerHTML = ''
    live2dInstanceRef.current = null

    if (!canRenderLive2D()) {
      setLive2dStatus('fallback')
      return
    }

    let disposed = false
    let resizeObserver: ResizeObserver | null = null
    let resizeHandler: (() => void) | null = null
    let readinessFallback: number | null = null
    let loadFailed = false
    setLive2dStatus('loading')

    import('oh-my-live2d')
      .then(({ loadOml2d }) => {
        if (disposed || !parentElement.isConnected) return

        const live2d = loadOml2d({
          parentElement,
          dockedPosition: 'left',
          initialStatus: 'active',
          mobileDisplay: true,
          primaryColor: spec.palette.accent,
          sayHello: false,
          transitionTime: 280,
          menus: { disable: true },
          statusBar: { disable: true },
          tips: {
            style: { display: 'none' },
            mobileStyle: { display: 'none' },
            idleTips: {
              wordTheDay: false,
              message: [],
              duration: 1,
              interval: 60_000,
              priority: 0,
            },
            welcomeTips: {
              duration: 1,
              priority: 0,
              message: {},
            },
            copyTips: {
              duration: 1,
              priority: 0,
              message: [],
            },
          },
          stageStyle: {
            position: 'absolute',
            left: 0,
            right: 'auto',
            bottom: 0,
            width: '100%',
            height: '100%',
            zIndex: 1,
            pointerEvents: 'none',
          },
          models: [
            {
              name: 'natori-technical-interviewer',
              path: LIVE2D_MODEL_PATH,
              scale: LIVE2D_BASE_SCALE,
              anchor: [0.5, 0.35],
              position: [LIVE2D_BASE_WIDTH * 0.5, LIVE2D_BASE_HEIGHT * 0.503],
              motionPreloadStrategy: 'IDLE',
              volume: 0,
              stageStyle: {
                position: 'absolute',
                left: 0,
                right: 'auto',
                bottom: 0,
                width: '100%',
                height: '100%',
                zIndex: 1,
                pointerEvents: 'none',
              },
            },
          ],
        })

        live2dInstanceRef.current = live2d
        live2d.clearTips?.()
        const fit = () => fitLive2DModel(live2d, parentElement)
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => fit())
          resizeObserver.observe(parentElement)
        } else {
          resizeHandler = fit
          window.addEventListener('resize', resizeHandler)
        }
        live2d.onLoad?.((status) => {
          if (disposed) return
          if (status === 'success') {
            setLive2dStatus('ready')
            requestAnimationFrame(fit)
            window.setTimeout(fit, 250)
            return
          }
          if (status === 'fail') loadFailed = true
          setLive2dStatus(status === 'fail' ? 'fallback' : 'loading')
        })
        readinessFallback = window.setTimeout(() => {
          if (disposed) return
          const canvas = parentElement.querySelector('canvas')
          if (!loadFailed && canvas && canvas.width > 0 && canvas.height > 0) {
            setLive2dStatus('ready')
            fit()
          }
        }, 3_000)
      })
      .catch(() => {
        loadFailed = true
        if (!disposed) setLive2dStatus('fallback')
      })

    return () => {
      disposed = true
      if (readinessFallback != null) window.clearTimeout(readinessFallback)
      resizeObserver?.disconnect()
      if (resizeHandler) window.removeEventListener('resize', resizeHandler)
      live2dInstanceRef.current?.stageSlideOut?.().catch(() => undefined)
      live2dInstanceRef.current = null
      parentElement.innerHTML = ''
    }
  }, [compact, spec.key, spec.palette.accent])

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
            className="virtual-interviewer__rig-preview"
            data-testid="virtual-interviewer-rig-preview"
            aria-hidden
          >
            <span className="virtual-interviewer__rig-dot virtual-interviewer__rig-dot--head" />
            <span className="virtual-interviewer__rig-dot virtual-interviewer__rig-dot--core" />
            <span className="virtual-interviewer__rig-line virtual-interviewer__rig-line--left" />
            <span className="virtual-interviewer__rig-line virtual-interviewer__rig-line--right" />
            <span className="virtual-interviewer__rig-label">2D</span>
          </div>
        ) : (
          <div className="virtual-interviewer__live2d-shell" aria-hidden>
            <div
              ref={live2dStageRef}
              className="virtual-interviewer__live2d-stage"
              data-live2d-status={live2dStatus}
              data-testid="virtual-interviewer-live2d-stage"
            />
            {live2dStatus !== 'ready' ? (
              <div className="virtual-interviewer__live2d-fallback">
                <span>LIVE2D</span>
                <small>{live2dStatus === 'loading' ? 'loading model' : 'webgl unavailable'}</small>
              </div>
            ) : null}
          </div>
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
