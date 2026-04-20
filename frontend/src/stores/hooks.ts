import { useShallow } from 'zustand/react/shallow'
import { useInterviewStore } from './configStore'
import type { RootState } from './slices/rootState'

/**
 * 领域级 hook 工厂，统一在 useShallow 下选择字段，避免大解构订阅整个 store。
 *
 * 使用：
 *   const { config, options, setConfig } = useConfig()
 *   const isRecording = useInterviewState(s => s.isRecording)   // 单字段
 *   const settings = useUiSettings()
 *
 * 选择 action 时也要走 hook（Zustand 的 action 引用稳定，但走 useShallow 不会有额外开销）。
 */

function makeShallowHook<T extends object>(selector: (s: RootState) => T) {
  return () => useInterviewStore(useShallow(selector))
}

// ---- Config / Devices / Options ---------------------------------------------
export const useConfig = makeShallowHook((s) => ({
  config: s.config,
  devices: s.devices,
  platformInfo: s.platformInfo,
  options: s.options,
  setConfig: s.setConfig,
  setDevices: s.setDevices,
  setOptions: s.setOptions,
}))

// ---- 录音 / 转写 / QA --------------------------------------------------------
export const useInterview = makeShallowHook((s) => ({
  isRecording: s.isRecording,
  isPaused: s.isPaused,
  audioLevel: s.audioLevel,
  isTranscribing: s.isTranscribing,
  transcriptions: s.transcriptions,
  qaPairs: s.qaPairs,
  streamingIds: s.streamingIds,
  currentStreamingId: s.currentStreamingId,
  setRecording: s.setRecording,
  setPaused: s.setPaused,
  setAudioLevel: s.setAudioLevel,
  setTranscribing: s.setTranscribing,
  addTranscription: s.addTranscription,
  startAnswer: s.startAnswer,
  appendThinkChunk: s.appendThinkChunk,
  appendAnswerChunk: s.appendAnswerChunk,
  finalizeAnswer: s.finalizeAnswer,
  cancelAnswer: s.cancelAnswer,
  setVisionVerify: s.setVisionVerify,
  setInitData: s.setInitData,
  clearSession: s.clearSession,
}))

// ---- STT / 模型健康 / Token usage -------------------------------------------
export const useStt = makeShallowHook((s) => ({
  sttLoaded: s.sttLoaded,
  sttLoading: s.sttLoading,
  modelHealth: s.modelHealth,
  tokenUsage: s.tokenUsage,
  setSttStatus: s.setSttStatus,
  setModelHealth: s.setModelHealth,
  setTokenUsage: s.setTokenUsage,
}))

// ---- 设置抽屉 ---------------------------------------------------------------
export const useUiSettings = makeShallowHook((s) => ({
  settingsOpen: s.settingsOpen,
  settingsDrawerTab: s.settingsDrawerTab,
  toggleSettings: s.toggleSettings,
  openConfigDrawer: s.openConfigDrawer,
  openModelsDrawer: s.openModelsDrawer,
  setSettingsDrawerTab: s.setSettingsDrawerTab,
}))

// ---- Toast / fallback -------------------------------------------------------
export const useToasts = makeShallowHook((s) => ({
  toasts: s.toasts,
  toastMessage: s.toastMessage,
  fallbackToast: s.fallbackToast,
  pushToast: s.pushToast,
  setToastMessage: s.setToastMessage,
  setFallbackToast: s.setFallbackToast,
  dismissToast: s.dismissToast,
}))

// ---- WebSocket 连接状态 ------------------------------------------------------
export const useWsStatus = makeShallowHook((s) => ({
  wsConnected: s.wsConnected,
  wsIsLeader: s.wsIsLeader,
  lastWSError: s.lastWSError,
  setWsConnected: s.setWsConnected,
  setWsIsLeader: s.setWsIsLeader,
  setLastWSError: s.setLastWSError,
}))

// ---- 简历优化器 -------------------------------------------------------------
export const useResumeOpt = makeShallowHook((s) => ({
  resumeOptStreaming: s.resumeOptStreaming,
  resumeOptResult: s.resumeOptResult,
  resumeOptLoading: s.resumeOptLoading,
  appendResumeOptChunk: s.appendResumeOptChunk,
  setResumeOptResult: s.setResumeOptResult,
  setResumeOptLoading: s.setResumeOptLoading,
  resetResumeOpt: s.resetResumeOpt,
}))

// ---- 练习模式 ---------------------------------------------------------------
export const usePractice = makeShallowHook((s) => ({
  practiceStatus: s.practiceStatus,
  practiceQuestions: s.practiceQuestions,
  practiceIndex: s.practiceIndex,
  practiceEvals: s.practiceEvals,
  practiceEvalStreaming: s.practiceEvalStreaming,
  practiceReport: s.practiceReport,
  practiceReportStreaming: s.practiceReportStreaming,
  practiceRecording: s.practiceRecording,
  practiceAnswerDraft: s.practiceAnswerDraft,
  setPracticeStatus: s.setPracticeStatus,
  setPracticeQuestions: s.setPracticeQuestions,
  setPracticeIndex: s.setPracticeIndex,
  appendPracticeEvalChunk: s.appendPracticeEvalChunk,
  finalizePracticeEval: s.finalizePracticeEval,
  appendPracticeReportChunk: s.appendPracticeReportChunk,
  finalizePracticeReport: s.finalizePracticeReport,
  setPracticeRecording: s.setPracticeRecording,
  setPracticeAnswerDraft: s.setPracticeAnswerDraft,
  appendPracticeAnswerDraft: s.appendPracticeAnswerDraft,
  resetPractice: s.resetPractice,
}))
