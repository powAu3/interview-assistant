import { create } from 'zustand'
import { createConfigSlice } from './slices/configSlice'
import { createInterviewSlice } from './slices/interviewSlice'
import { createSttSlice } from './slices/sttSlice'
import { createUiSlice } from './slices/uiSlice'
import { createResumeOptSlice } from './slices/resumeOptSlice'
import { createPracticeSlice } from './slices/practiceSlice'
import type { RootState } from './slices/rootState'

export type {
  AppConfig,
  ModelInfo,
  ModelFullInfo,
  QAPair,
  PracticeQuestion,
  PracticeEvaluation,
  ToastLevel,
  ToastItem,
  TokenUsage,
  PlatformInfo,
  DeviceItem,
  OptionsInfo,
  SettingsDrawerTab,
  ModelHealthStatus,
  PracticeStatus,
} from './slices/types'
export type { RootState } from './slices/rootState'

/**
 * 全量 store。结构由 6 个 slice 组合而成（位于 ./slices/）：
 *   - configSlice:    config / devices / platformInfo / options
 *   - interviewSlice: 录音/转写/QA 流式状态
 *   - sttSlice:       STT 加载状态/模型健康/Token usage
 *   - uiSlice:        设置抽屉/Toast/WS 连接状态
 *   - resumeOptSlice: 简历优化器
 *   - practiceSlice:  练习模式
 *
 * ⚠️ 性能注意：直接调用 `useInterviewStore()` 会订阅整个 store，任意字段变化都会触发组件重渲染。
 *    对热路径组件（App / ControlBar / 设置抽屉等）请改用 `@/stores/hooks` 中的领域 hook，
 *    或 `useInterviewStore(useShallow(s => ({ ... })))` 精确订阅。
 */
export const useInterviewStore = create<RootState>()((...a) => ({
  ...createConfigSlice(...a),
  ...createInterviewSlice(...a),
  ...createSttSlice(...a),
  ...createUiSlice(...a),
  ...createResumeOptSlice(...a),
  ...createPracticeSlice(...a),
}))
