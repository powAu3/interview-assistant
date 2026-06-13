import type * as Three from 'three'

import type {
  VirtualInterviewerSpeechSignal,
  VirtualInterviewerState,
} from './virtualInterviewerState'

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

export function canRenderWebGL() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (!('WebGLRenderingContext' in window)) return false
  const canvas = document.createElement('canvas')
  return Boolean(
    canvas.getContext('webgl') || canvas.getContext('experimental-webgl'),
  )
}

export function disposeObject(root: Three.Object3D) {
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

export function collectRig(root: Three.Object3D): BoneRig {
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

export function tuneRocketboxMaterials(root: Three.Object3D) {
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

export function rememberBaseRotations(rig: BoneRig) {
  return Object.fromEntries(
    Object.entries(rig).map(([key, bone]) => [key, bone?.rotation.clone()]),
  ) as Partial<Record<keyof BoneRig, Three.Euler>>
}

export function applyRigState(args: {
  rig: BoneRig
  base: Partial<Record<keyof BoneRig, Three.Euler>>
  root: Three.Object3D
  state: VirtualInterviewerState
  speechSignal?: VirtualInterviewerSpeechSignal
  time: number
}) {
  const { rig, base, root, state, speechSignal, time } = args
  const speechActive = Boolean(speechSignal?.active)
  const energy = clamp01(speechSignal?.energy ?? 0)
  const fallbackSpeakingPulse = state === 'speaking' ? (Math.sin(time * 11.5) + 1) * 0.5 : 0
  const mouthOpen = clamp01(
    speechActive
      ? (speechSignal?.mouthOpen ?? 0) + Math.sin(time * 23) * 0.018 * energy
      : fallbackSpeakingPulse * 0.72,
  )
  const listeningNod = state === 'listening' ? pulse(time, 4.3, 1.15, 0.44) * 0.052 : 0
  const listeningLean = state === 'listening' ? Math.sin(time * 0.34) * 0.018 : 0
  const speakingNod = state === 'speaking' ? Math.sin(time * 1.45) * (0.01 + energy * 0.018) : 0
  const thinkingTurn = state === 'thinking' ? -0.1 + Math.sin(time * 0.8) * 0.02 : 0
  const debriefStillness = state === 'debrief' ? 0.25 : 1
  const idleBreathe = Math.sin(time * 1.25) * 0.008 * debriefStillness
  const microGazeY = Math.sin(time * 0.53) * 0.018 + Math.sin(time * 0.19 + 1.7) * 0.012
  const microGazeZ = Math.sin(time * 0.72 + 0.8) * 0.008
  const attentionTilt = state === 'listening' ? -0.018 : state === 'speaking' ? 0.012 : 0

  root.position.y = -0.32 + idleBreathe
  root.rotation.y = -0.12 + thinkingTurn + listeningLean + Math.sin(time * 0.45) * 0.014 * debriefStillness

  if (rig.head && base.head) {
    rig.head.rotation.x = base.head.x + attentionTilt + listeningNod + speakingNod + mouthOpen * 0.012
    rig.head.rotation.y = base.head.y + thinkingTurn * 0.65 + microGazeY * debriefStillness
    rig.head.rotation.z = base.head.z + microGazeZ * debriefStillness
  }

  if (rig.neck && base.neck) {
    rig.neck.rotation.x = base.neck.x + listeningNod * 0.42 + idleBreathe * 0.7
    rig.neck.rotation.y = base.neck.y + thinkingTurn * 0.28 + microGazeY * 0.35
  }

  if (rig.spine && base.spine) {
    rig.spine.rotation.x = base.spine.x + idleBreathe * 0.9 + listeningNod * 0.18
  }

  if (rig.jaw && base.jaw) {
    rig.jaw.rotation.x = base.jaw.x + mouthOpen * 0.13
  }

  if (rig.mouthBottom && base.mouthBottom) {
    rig.mouthBottom.rotation.x = base.mouthBottom.x + mouthOpen * 0.095
  }

  if (rig.lowerLip && base.lowerLip) {
    rig.lowerLip.rotation.x = base.lowerLip.x + mouthOpen * 0.055
  }

  if (rig.upperLip && base.upperLip) {
    rig.upperLip.rotation.x = base.upperLip.x - mouthOpen * 0.028
  }

  const blink = Math.max(
    pulse(time, 3.65, 0.42, 0.12),
    pulse(time, 6.9, 2.86, 0.11) * 0.9,
    pulse(time, 10.7, 8.1, 0.1) * 0.74,
  )
  if (rig.leftEyeTop && base.leftEyeTop) {
    rig.leftEyeTop.rotation.x = base.leftEyeTop.x + blink * 0.08
  }
  if (rig.rightEyeTop && base.rightEyeTop) {
    rig.rightEyeTop.rotation.x = base.rightEyeTop.x + blink * 0.08
  }
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function pulse(time: number, interval: number, offset: number, duration: number) {
  const phase = (time + offset) % interval
  if (phase > duration) return 0
  return Math.sin((phase / duration) * Math.PI)
}
