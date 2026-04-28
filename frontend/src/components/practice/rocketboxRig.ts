import type * as Three from 'three'

import type { VirtualInterviewerState } from './virtualInterviewerState'

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
