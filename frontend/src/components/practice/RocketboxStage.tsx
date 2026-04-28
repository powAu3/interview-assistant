import { useEffect, useRef, useState } from 'react'
import type * as Three from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { ROCKETBOX_MODEL_PATH, ROCKETBOX_POSTER_PATH } from './rocketboxAssets'
import {
  applyRigState,
  canRenderWebGL,
  collectRig,
  disposeObject,
  rememberBaseRotations,
  tuneRocketboxMaterials,
} from './rocketboxRig'
import type { VirtualInterviewerState } from './virtualInterviewerState'

type RocketboxLoadStatus = 'loading' | 'ready' | 'fallback'

export function RocketboxStage({ state }: { state: VirtualInterviewerState }) {
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
      import('./rocketboxThreeRuntime'),
      import('./rocketboxRendererRuntime'),
    ])
      .then(([THREE, RENDERER]) => {
        if (disposed || !parentElement.isConnected) return

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20)
        camera.position.set(0.02, 1.02, 2.65)
        camera.lookAt(0, 1.36, 0)

        renderer = new RENDERER.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
        })
        renderer.setClearColor(0x000000, 0)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.outputColorSpace = RENDERER.SRGBColorSpace
        renderer.toneMapping = RENDERER.ACESFilmicToneMapping
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

        const loader = new THREE.GLTFLoader()
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
