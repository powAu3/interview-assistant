import { create } from 'zustand'

export interface ModelInfo {
  name: string
  supports_think: boolean
  supports_vision: boolean
}

export interface AppConfig {
  models: ModelInfo[]
  active_model: number
  model_name: string
  temperature: number
  max_tokens: number
  think_mode: boolean
  whisper_model: string
  whisper_language: string
  position: string
  language: string
  auto_detect: boolean
  silence_threshold: number
  silence_duration: number
  api_key_set: boolean
  has_resume: boolean
}

export interface QAPair {
  id: string
  question: string
  answer: string
  thinkContent: string
  isThinking: boolean
  timestamp: number
}

export interface PracticeQuestion {
  id: number
  question: string
  category: string
}

export interface PracticeEvaluation {
  question_id: number
  question: string
  answer: string
  score: number
  feedback: string
}

interface InterviewState {
  config: AppConfig | null
  devices: Array<{ id: number; name: string; channels: number; is_loopback: boolean; host_api: string }>
  platformInfo: { platform: string; needs_virtual_device: boolean; instructions: string } | null
  options: { positions: string[]; languages: string[]; whisper_models: string[] } | null

  isRecording: boolean
  audioLevel: number
  isTranscribing: boolean
  transcriptions: string[]
  qaPairs: QAPair[]
  currentStreamingId: string | null
  sttLoaded: boolean
  sttLoading: boolean

  settingsOpen: boolean
  modelHealth: Record<number, 'checking' | 'ok' | 'error'>
  tokenUsage: { prompt: number; completion: number; total: number }
  fallbackToast: { from: string; to: string; reason: string } | null

  // Resume optimizer
  resumeOptStreaming: string
  resumeOptResult: string
  resumeOptLoading: boolean

  // Practice mode
  practiceStatus: 'idle' | 'generating' | 'questioning' | 'evaluating' | 'report' | 'finished'
  practiceQuestions: PracticeQuestion[]
  practiceIndex: number
  practiceEvals: PracticeEvaluation[]
  practiceEvalStreaming: string
  practiceReport: string
  practiceReportStreaming: string
  practiceRecording: boolean

  setConfig: (config: AppConfig) => void
  setDevices: (devices: any[], platformInfo: any) => void
  setOptions: (options: any) => void
  setRecording: (v: boolean) => void
  setAudioLevel: (v: number) => void
  setTranscribing: (v: boolean) => void
  addTranscription: (text: string) => void
  startAnswer: (id: string, question: string) => void
  appendThinkChunk: (id: string, chunk: string) => void
  appendAnswerChunk: (id: string, chunk: string) => void
  finalizeAnswer: (id: string, question: string, answer: string, thinkContent?: string) => void
  setInitData: (data: any) => void
  setSttStatus: (loaded: boolean, loading: boolean) => void
  toggleSettings: () => void
  clearSession: () => void
  setModelHealth: (index: number, status: 'checking' | 'ok' | 'error') => void
  setTokenUsage: (usage: { prompt: number; completion: number; total: number }) => void
  setFallbackToast: (toast: { from: string; to: string; reason: string } | null) => void

  // Resume optimizer actions
  appendResumeOptChunk: (chunk: string) => void
  setResumeOptResult: (text: string) => void
  setResumeOptLoading: (v: boolean) => void
  resetResumeOpt: () => void

  // Practice actions
  setPracticeStatus: (s: InterviewState['practiceStatus']) => void
  setPracticeQuestions: (qs: PracticeQuestion[]) => void
  setPracticeIndex: (i: number) => void
  appendPracticeEvalChunk: (chunk: string) => void
  finalizePracticeEval: (ev: PracticeEvaluation) => void
  appendPracticeReportChunk: (chunk: string) => void
  finalizePracticeReport: (report: string) => void
  setPracticeRecording: (v: boolean) => void
  resetPractice: () => void
}

export const useInterviewStore = create<InterviewState>((set) => ({
  config: null,
  devices: [],
  platformInfo: null,
  options: null,
  isRecording: false,
  audioLevel: 0,
  isTranscribing: false,
  transcriptions: [],
  qaPairs: [],
  currentStreamingId: null,
  sttLoaded: false,
  sttLoading: true,
  settingsOpen: false,
  modelHealth: {},
  tokenUsage: { prompt: 0, completion: 0, total: 0 },
  fallbackToast: null,
  resumeOptStreaming: '',
  resumeOptResult: '',
  resumeOptLoading: false,

  practiceStatus: 'idle',
  practiceQuestions: [],
  practiceIndex: 0,
  practiceEvals: [],
  practiceEvalStreaming: '',
  practiceReport: '',
  practiceReportStreaming: '',
  practiceRecording: false,

  setConfig: (config) => set({ config }),
  setDevices: (devices, platformInfo) => set({ devices, platformInfo }),
  setOptions: (options) => set({ options }),
  setRecording: (v) => set({ isRecording: v }),
  setAudioLevel: (v) => set({ audioLevel: v }),
  setTranscribing: (v) => set({ isTranscribing: v }),
  addTranscription: (text) => set((s) => ({ transcriptions: [...s.transcriptions, text] })),
  startAnswer: (id, question) =>
    set((s) => ({
      currentStreamingId: id,
      qaPairs: [...s.qaPairs, { id, question, answer: '', thinkContent: '', isThinking: false, timestamp: Date.now() / 1000 }],
    })),
  appendThinkChunk: (id, chunk) =>
    set((s) => ({
      qaPairs: s.qaPairs.map((qa) => (qa.id === id ? { ...qa, thinkContent: qa.thinkContent + chunk, isThinking: true } : qa)),
    })),
  appendAnswerChunk: (id, chunk) =>
    set((s) => ({
      qaPairs: s.qaPairs.map((qa) => (qa.id === id ? { ...qa, answer: qa.answer + chunk, isThinking: false } : qa)),
    })),
  finalizeAnswer: (id, question, answer, thinkContent) =>
    set((s) => ({
      currentStreamingId: null,
      qaPairs: s.qaPairs.map((qa) => (qa.id === id ? { ...qa, question, answer, thinkContent: thinkContent ?? qa.thinkContent, isThinking: false } : qa)),
    })),
  setInitData: (data) =>
    set({
      transcriptions: data.transcriptions ?? [],
      qaPairs: data.qa_pairs ?? [],
      isRecording: data.is_recording ?? false,
      sttLoaded: data.stt_loaded ?? false,
    }),
  setSttStatus: (loaded, loading) => set({ sttLoaded: loaded, sttLoading: loading }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  clearSession: () => set({ transcriptions: [], qaPairs: [], currentStreamingId: null }),
  setModelHealth: (index, status) => set((s) => ({ modelHealth: { ...s.modelHealth, [index]: status } })),
  setTokenUsage: (usage) => set({ tokenUsage: usage }),
  setFallbackToast: (toast) => set({ fallbackToast: toast }),

  appendResumeOptChunk: (chunk) => set((s) => ({ resumeOptStreaming: s.resumeOptStreaming + chunk })),
  setResumeOptResult: (text) => set({ resumeOptResult: text, resumeOptStreaming: '' }),
  setResumeOptLoading: (v) => set({ resumeOptLoading: v }),
  resetResumeOpt: () => set({ resumeOptStreaming: '', resumeOptResult: '', resumeOptLoading: false }),

  setPracticeStatus: (s) => set({ practiceStatus: s }),
  setPracticeQuestions: (qs) => set({ practiceQuestions: qs, practiceIndex: 0 }),
  setPracticeIndex: (i) => set({ practiceIndex: i }),
  appendPracticeEvalChunk: (chunk) => set((s) => ({ practiceEvalStreaming: s.practiceEvalStreaming + chunk })),
  finalizePracticeEval: (ev) =>
    set((s) => ({
      practiceEvals: [...s.practiceEvals, ev],
      practiceEvalStreaming: '',
    })),
  appendPracticeReportChunk: (chunk) => set((s) => ({ practiceReportStreaming: s.practiceReportStreaming + chunk })),
  finalizePracticeReport: (report) => set({ practiceReport: report, practiceReportStreaming: '' }),
  setPracticeRecording: (v) => set({ practiceRecording: v }),
  resetPractice: () =>
    set({
      practiceStatus: 'idle',
      practiceQuestions: [],
      practiceIndex: 0,
      practiceEvals: [],
      practiceEvalStreaming: '',
      practiceReport: '',
      practiceReportStreaming: '',
      practiceRecording: false,
    }),
}))
