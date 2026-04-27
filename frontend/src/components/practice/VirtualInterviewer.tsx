import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from 'react'

import clsx from 'clsx'
import type * as Three from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

import {
  resolveVirtualInterviewerPersona,
  type VirtualInterviewerPersonaKey,
} from './virtualInterviewerPersona'
import {
  getVirtualInterviewerStateLabel,
  type VirtualInterviewerState,
} from './virtualInterviewerState'

const ROCKETBOX_MODEL_PATH = '/avatars/rocketbox-interviewer.glb'
const ROCKETBOX_POSTER_PATH = '/avatars/rocketbox-interviewer-poster.png'

type RocketboxLoadStatus = 'loading' | 'ready' | 'fallback'
type BoneRig = Partial<
  Record<
    | 'head'
    | 'neck'
    | 'spine'
    | 'jaw'
    | 'mouthBottom'
    | 'lowerLip'
    | 'upperLip'
    | 'leftEyeTop'
    | 'rightEyeTop',
    Three.Object3D
  >
>

function canRenderWebGL() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (!('WebGLRenderingContext' in window)) return false
  const canvas = document.createElement('canvas')
  return Boolean(
    canvas.getContext('webgl') || canvas.getContext('experimental-webgl'),
  )
}

function disposeObject(root: Three.Object3D) {
  root.traverse((object) => {
    const mesh = object as Three.Mesh
    mesh.geometry?.dispose()

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []

    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value && typeof value === 'object' && 'isTexture' in value) {
          ;(value as Three.Texture).dispose()
        }
      })
      material.dispose()
    })
  })
}

function collectRig(root: Three.Object3D): BoneRig {
  return {
    head: root.getObjectByName('Bip01 Head') ?? undefined,
    neck: root.getObjectByName('Bip01 Neck') ?? undefined,
    spine: root.getObjectByName('Bip01 Spine2') ?? undefined,
    jaw: root.getObjectByName('Bip01 MJaw') ?? undefined,
    mouthBottom: root.getObjectByName('Bip01 MMouthBottom') ?? root.getObjectByName('Bip01 LMouthBottom') ?? undefined,
    lowerLip: root.getObjectByName('Bip01 MBottomLip') ?? undefined,
    upperLip: root.getObjectByName('Bip01 MUpperLip') ?? undefined,
    leftEyeTop: root.getObjectByName('Bip01 LEyeBlinkTop') ?? undefined,
    rightEyeTop: root.getObjectByName('Bip01 REyeBlinkTop') ?? undefined,
  }
}

function tuneRocketboxMaterials(root: Three.Object3D) {
  root.traverse((object) => {
    const mesh = object as Three.Mesh
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []

    materials.forEach((material) => {
      const standardMaterial = material as Three.MeshStandardMaterial
      standardMaterial.metalness = 0
      standardMaterial.roughness = material.name.includes('head') ? 0.68 : 0.82
      standardMaterial.toneMapped = true
      if (material.name.includes('opacity')) {
        standardMaterial.transparent = true
        standardMaterial.opacity = 0
        standardMaterial.colorWrite = false
        standardMaterial.depthWrite = false
      }
      standardMaterial.needsUpdate = true
    })
  })
}

function rememberBaseRotations(rig: BoneRig) {
  return Object.fromEntries(
    Object.entries(rig).map(([key, bone]) => [key, bone?.rotation.clone()]),
  ) as Partial<Record<keyof BoneRig, Three.Euler>>
}

function applyRigState(args: {
  rig: BoneRig
  base: Partial<Record<keyof BoneRig, Three.Euler>>
  root: Three.Object3D
  state: VirtualInterviewerState
  time: number
}) {
  const { rig, base, root, state, time } = args
  const speakingPulse = state === 'speaking' ? (Math.sin(time * 11.5) + 1) * 0.5 : 0
  const listeningNod = state === 'listening' ? Math.sin(time * 1.7) * 0.035 : 0
  const thinkingTurn = state === 'thinking' ? -0.1 + Math.sin(time * 0.8) * 0.02 : 0
  const debriefStillness = state === 'debrief' ? 0.25 : 1
  const idleBreathe = Math.sin(time * 1.25) * 0.008 * debriefStillness

  root.position.y = -0.32 + idleBreathe
  root.rotation.y = -0.12 + thinkingTurn + Math.sin(time * 0.45) * 0.015 * debriefStillness

  if (rig.head && base.head) {
    rig.head.rotation.x = base.head.x + listeningNod + speakingPulse * 0.018
    rig.head.rotation.y = base.head.y + thinkingTurn * 0.65 + Math.sin(time * 0.65) * 0.025 * debriefStillness
    rig.head.rotation.z = base.head.z + Math.sin(time * 0.9) * 0.01 * debriefStillness
  }

  if (rig.neck && base.neck) {
    rig.neck.rotation.x = base.neck.x + listeningNod * 0.45
    rig.neck.rotation.y = base.neck.y + thinkingTurn * 0.28
  }

  if (rig.spine && base.spine) {
    rig.spine.rotation.x = base.spine.x + idleBreathe * 0.9
  }

  if (rig.jaw && base.jaw) {
    rig.jaw.rotation.x = base.jaw.x + speakingPulse * 0.11
  }

  if (rig.mouthBottom && base.mouthBottom) {
    rig.mouthBottom.rotation.x = base.mouthBottom.x + speakingPulse * 0.08
  }

  if (rig.lowerLip && base.lowerLip) {
    rig.lowerLip.rotation.x = base.lowerLip.x + speakingPulse * 0.05
  }

  if (rig.upperLip && base.upperLip) {
    rig.upperLip.rotation.x = base.upperLip.x - speakingPulse * 0.025
  }

  const blinkPhase = time % 4.8
  const blink = blinkPhase < 0.12 ? Math.sin((blinkPhase / 0.12) * Math.PI) : 0
  if (rig.leftEyeTop && base.leftEyeTop) {
    rig.leftEyeTop.rotation.x = base.leftEyeTop.x + blink * 0.08
  }
  if (rig.rightEyeTop && base.rightEyeTop) {
    rig.rightEyeTop.rotation.x = base.rightEyeTop.x + blink * 0.08
  }
}

function RocketboxStage({ state }: { state: VirtualInterviewerState }) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef(state)
  const [status, setStatus] = useState<RocketboxLoadStatus>('loading')

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const parentElement = stageRef.current
    if (!parentElement) return

    parentElement.innerHTML = ''
    if (!canRenderWebGL()) {
      setStatus('fallback')
      return
    }

    let disposed = false
    let resizeObserver: ResizeObserver | null = null
    let loadedRoot: Three.Object3D | null = null
    let renderer: Three.WebGLRenderer | null = null

    setStatus('loading')

    Promise.all([
      import('three'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
    ])
      .then(([THREE, { GLTFLoader }]) => {
        if (disposed || !parentElement.isConnected) return

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20)
        camera.position.set(0.02, 1.02, 2.65)
        camera.lookAt(0, 1.36, 0)

        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
        })
        renderer.setClearColor(0x000000, 0)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.04
        renderer.domElement.setAttribute('aria-hidden', 'true')
        parentElement.appendChild(renderer.domElement)

        const keyLight = new THREE.DirectionalLight(0xf4f7fb, 3.6)
        keyLight.position.set(0.7, 2.35, 3)
        scene.add(keyLight)
        const fillLight = new THREE.HemisphereLight(0xd8e2ec, 0x34383f, 1.75)
        scene.add(fillLight)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.42)
        scene.add(ambientLight)
        const rimLight = new THREE.DirectionalLight(0x9eb7cf, 0.7)
        rimLight.position.set(1.5, 1.9, -2.4)
        scene.add(rimLight)

        const resize = () => {
          const rect = parentElement.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return
          camera.aspect = rect.width / rect.height
          camera.updateProjectionMatrix()
          renderer?.setSize(rect.width, rect.height, false)
        }

        const loader = new GLTFLoader()
        loader.load(
          ROCKETBOX_MODEL_PATH,
          (gltf: GLTF) => {
            if (disposed) {
              disposeObject(gltf.scene)
              return
            }

            const root = gltf.scene
            loadedRoot = root
            root.position.set(0, -0.32, 0)
            root.rotation.y = -0.12
            root.scale.setScalar(1.08)
            tuneRocketboxMaterials(root)
            scene.add(root)

            const rig = collectRig(root)
            const baseRotations = rememberBaseRotations(rig)
            const startedAt = performance.now()

            const renderOnce = () => {
              if (disposed) return
              const time = (performance.now() - startedAt) / 1000
              applyRigState({
                rig,
                base: baseRotations,
                root,
                state: stateRef.current,
                time,
              })
              renderer?.render(scene, camera)
            }

            resize()
            renderOnce()
            setStatus('ready')
          },
          undefined,
          () => {
            if (!disposed) setStatus('fallback')
          },
        )

        resizeObserver = new ResizeObserver(resize)
        resizeObserver.observe(parentElement)
        resize()
      })
      .catch(() => {
        if (!disposed) setStatus('fallback')
      })

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      if (loadedRoot) disposeObject(loadedRoot)
      renderer?.dispose()
      parentElement.innerHTML = ''
    }
  }, [])

  return (
    <div className="virtual-interviewer__three-shell" aria-hidden>
      <div
        ref={stageRef}
        className="virtual-interviewer__three-stage"
        data-rocketbox-status={status}
        data-testid="virtual-interviewer-three-stage"
      />
      {/* The converted GLB keeps the Three.js path alive; the Rocketbox poster avoids broken facial cards until a retarget pass lands. */}
      {status === 'ready' ? (
        <div className="virtual-interviewer__three-poster">
          <img src={ROCKETBOX_POSTER_PATH} alt="" />
        </div>
      ) : null}
      {status !== 'ready' ? (
        <div className="virtual-interviewer__three-fallback">
          <img src={ROCKETBOX_POSTER_PATH} alt="" />
          <small>{status === 'loading' ? 'loading model' : 'webgl unavailable'}</small>
        </div>
      ) : null}
    </div>
  )
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
