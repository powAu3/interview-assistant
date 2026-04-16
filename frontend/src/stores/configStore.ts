import { create } from 'zustand'


const CHUNK_THROTTLE_MS = 50
const _chunkBuffer: Map<string, { answer: string; think: string }> = new Map()
let _chunkFlushTimer: ReturnType<typeof setTimeout> | null = null

export interface ModelInfo {
  name: string
  supports_think: boolean
  supports_vision: boolean
  enabled?: boolean
}

export interface ModelFullInfo {
  name: string
  api_base_url: string
  api_key: string
  model: string
  supports_think: boolean
  supports_vision: boolean
  enabled: boolean
  has_key: boolean
}

export interface AppConfig {
  models: ModelInfo[]
  active_model: number
  model_name: string
  temperature: number
  max_tokens: number
  think_mode: boolean
  stt_provider: string
  whisper_model: string
  whisper_language: string
  doubao_stt_app_id: string
  doubao_stt_access_token: string
  doubao_stt_resource_id: string
  doubao_stt_boosting_table_id: string
  iflytek_stt_app_id: string
  iflytek_stt_api_key: string
  iflytek_stt_api_secret: string
  position: string
  language: string
  /** 模拟练习候选人维度：campus_intern=校招/实习，social=社招 */
  practice_audience?: string
  auto_detect: boolean
  silence_threshold: number
  silence_duration: number
  api_key_set: boolean
  has_resume: boolean
  /** 当前生效简历在历史中的 id，无则 null */
  resume_active_history_id?: number | null
  /** 当前生效简历原始文件名 */
  resume_active_filename?: string | null
  max_parallel_answers?: number
  /** 流式答案区：距底部小于该像素则自动滚到底 */
  answer_autoscroll_bottom_px?: number
  /** 转写有效字符下限（去标点后计汉字/字母/数字），低于则不展示、不自动答题 */
  transcription_min_sig_chars?: number
  /** 多段 ASR 合并：上一段结束后静默超过该秒数再送出；0=每段立即发送 */
  assist_transcription_merge_gap_sec?: number
  /** 从首段 ASR 起最长等待（秒），超时强制送出 */
  assist_transcription_merge_max_sec?: number
  /** 高 churn 场景下自动切短答 */
  assist_high_churn_short_answer?: boolean
  /** 电脑截图区域：full | left_half | right_half | top_half | bottom_half */
  screen_capture_region?: string
  /** 笔试模式：截屏后选择题直接出答案，编程题直接出代码 */
  written_exam_mode?: boolean
  /** 笔试模式下是否开启深度思考 */
  written_exam_think?: boolean
}

export interface QAPair {
  id: string
  question: string
  answer: string
  thinkContent: string
  isThinking: boolean
  timestamp: number
  questionSource?: string
  modelLabel?: string
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
  options: {
    positions: string[]
    languages: string[]
    practice_audiences?: string[]
    stt_providers?: string[]
    whisper_models: string[]
    screen_capture_regions?: string[]
  } | null

  isRecording: boolean
  isPaused: boolean
  audioLevel: number
  isTranscribing: boolean
  transcriptions: string[]
  qaPairs: QAPair[]
  streamingIds: string[]
  currentStreamingId: string | null
  sttLoaded: boolean
  sttLoading: boolean

  settingsOpen: boolean
  /** 抽屉内标签：设置 = 常用；配置 = VAD/LLM 等；模型 = 模型 CRUD */
  settingsDrawerTab: 'general' | 'config' | 'models'
  modelHealth: Record<number, 'checking' | 'ok' | 'error'>
  tokenUsage: {
    prompt: number
    completion: number
    total: number
    byModel?: Record<string, { prompt: number; completion: number }>
  }
  fallbackToast: { from: string; to: string; reason: string } | null
  toastMessage: string | null
  lastWSError: string | null
  wsConnected: boolean

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
  practiceAnswerDraft: string

  setConfig: (config: AppConfig) => void
  setDevices: (devices: any[], platformInfo: any) => void
  setOptions: (options: any) => void
  setRecording: (v: boolean) => void
  setPaused: (v: boolean) => void
  setAudioLevel: (v: number) => void
  setTranscribing: (v: boolean) => void
  addTranscription: (text: string) => void
  startAnswer: (
    id: string,
    question: string,
    meta?: { source?: string; modelName?: string },
  ) => void
  appendThinkChunk: (id: string, chunk: string) => void
  appendAnswerChunk: (id: string, chunk: string) => void
  finalizeAnswer: (
    id: string,
    question: string,
    answer: string,
    thinkContent?: string,
    modelName?: string,
  ) => void
  cancelAnswer: (id: string) => void
  setInitData: (data: any) => void
  setSttStatus: (loaded: boolean, loading: boolean) => void
  toggleSettings: () => void
  openConfigDrawer: () => void
  openModelsDrawer: () => void
  setSettingsDrawerTab: (tab: 'general' | 'config' | 'models') => void
  clearSession: () => void
  setModelHealth: (index: number, status: 'checking' | 'ok' | 'error') => void
  setTokenUsage: (usage: InterviewState['tokenUsage']) => void
  setFallbackToast: (toast: { from: string; to: string; reason: string } | null) => void
  setToastMessage: (msg: string | null) => void
  setLastWSError: (msg: string | null) => void
  setWsConnected: (v: boolean) => void

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
  setPracticeAnswerDraft: (text: string) => void
  appendPracticeAnswerDraft: (text: string) => void
  resetPractice: () => void
}

function _scheduleChunkFlush(set: (fn: (s: InterviewState) => Partial<InterviewState>) => void) {
  if (_chunkFlushTimer !== null) return
  _chunkFlushTimer = setTimeout(() => {
    _chunkFlushTimer = null
    const pending = new Map(_chunkBuffer)
    _chunkBuffer.clear()
    if (pending.size === 0) return
    set((s) => ({
      qaPairs: s.qaPairs.map((qa) => {
        const buf = pending.get(qa.id)
        if (!buf) return qa
        return {
          ...qa,
          thinkContent: buf.think ? qa.thinkContent + buf.think : qa.thinkContent,
          answer: buf.answer ? qa.answer + buf.answer : qa.answer,
          isThinking: buf.answer ? false : buf.think ? true : qa.isThinking,
        }
      }),
    }))
  }, CHUNK_THROTTLE_MS)
}

export const useInterviewStore = create<InterviewState>((set) => ({
  config: null,
  devices: [],
  platformInfo: null,
  options: null,
  isRecording: false,
  isPaused: false,
  audioLevel: 0,
  isTranscribing: false,
  transcriptions: [],
  qaPairs: [],
  streamingIds: [],
  currentStreamingId: null,
  sttLoaded: false,
  sttLoading: true,
  settingsOpen: false,
  settingsDrawerTab: 'general',
  modelHealth: {},
  tokenUsage: { prompt: 0, completion: 0, total: 0, byModel: {} },
  fallbackToast: null,
  toastMessage: null,
  lastWSError: null,
  wsConnected: false,
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
  practiceAnswerDraft: '',

  setConfig: (config) => set({ config }),
  setDevices: (devices, platformInfo) => set({ devices, platformInfo }),
  setOptions: (options) => set({ options }),
  setRecording: (v) => set({ isRecording: v }),
  setPaused: (v) => set({ isPaused: v }),
  setAudioLevel: (v) => set({ audioLevel: v }),
  setTranscribing: (v) => set({ isTranscribing: v }),
  addTranscription: (text) => set((s) => ({ transcriptions: [...s.transcriptions, text] })),
  startAnswer: (id, question, meta) =>
    set((s) => ({
      currentStreamingId: id,
      streamingIds: [...s.streamingIds, id],
      qaPairs: [
        ...s.qaPairs,
        {
          id,
          question,
          answer: '',
          thinkContent: '',
          isThinking: false,
          timestamp: Date.now() / 1000,
          questionSource: meta?.source,
          modelLabel: meta?.modelName,
        },
      ],
    })),
  appendThinkChunk: (id, chunk) => {
    const buf = _chunkBuffer.get(id) ?? { answer: '', think: '' }
    buf.think += chunk
    _chunkBuffer.set(id, buf)
    _scheduleChunkFlush(set)
  },
  appendAnswerChunk: (id, chunk) => {
    const buf = _chunkBuffer.get(id) ?? { answer: '', think: '' }
    buf.answer += chunk
    _chunkBuffer.set(id, buf)
    _scheduleChunkFlush(set)
  },
  finalizeAnswer: (id, question, answer, thinkContent, modelName) => {
    _chunkBuffer.delete(id)
    set((s) => {
      const next = s.streamingIds.filter((x) => x !== id)
      return {
        currentStreamingId: next.length ? next[next.length - 1] : null,
        streamingIds: next,
        qaPairs: s.qaPairs.map((qa) =>
          qa.id === id
            ? {
                ...qa,
                question,
                answer,
                thinkContent: thinkContent ?? qa.thinkContent,
                isThinking: false,
                modelLabel: modelName ?? qa.modelLabel,
              }
            : qa,
        ),
      }
    })
  },
  cancelAnswer: (id) => {
    _chunkBuffer.delete(id)
    set((s) => {
      const next = s.streamingIds.filter((x) => x !== id)
      return {
        currentStreamingId: next.length ? next[next.length - 1] : null,
        streamingIds: next,
        qaPairs: s.qaPairs.map((qa) =>
          qa.id === id ? { ...qa, answer: '[已取消]', isThinking: false } : qa,
        ),
      }
    })
  },
  setInitData: (data) => {
    _chunkBuffer.clear()
    if (_chunkFlushTimer !== null) { clearTimeout(_chunkFlushTimer); _chunkFlushTimer = null }
    set({
      transcriptions: data.transcriptions ?? [],
      qaPairs: (data.qa_pairs ?? []).map((qa: Partial<QAPair> & { id: string; question: string; answer: string }) => ({
        ...qa,
        thinkContent: qa.thinkContent ?? '',
        isThinking: false,
        timestamp: qa.timestamp ?? Date.now() / 1000,
        questionSource: (qa as any).source ?? qa.questionSource,
        modelLabel: (qa as any).model_name ?? qa.modelLabel,
      })),
      currentStreamingId: null,
      streamingIds: [],
      isRecording: data.is_recording ?? false,
      isPaused: data.is_paused ?? false,
      sttLoaded: data.stt_loaded ?? false,
    })
  },
  setSttStatus: (loaded, loading) => set({ sttLoaded: loaded, sttLoading: loading }),
  toggleSettings: () =>
    set((s) => {
      if (s.settingsOpen) return { settingsOpen: false }
      return { settingsOpen: true, settingsDrawerTab: 'general' }
    }),
  openConfigDrawer: () => set({ settingsOpen: true, settingsDrawerTab: 'config' }),
  openModelsDrawer: () => set({ settingsOpen: true, settingsDrawerTab: 'models' }),
  setSettingsDrawerTab: (tab) => set({ settingsDrawerTab: tab }),
  clearSession: () => {
    _chunkBuffer.clear()
    if (_chunkFlushTimer !== null) { clearTimeout(_chunkFlushTimer); _chunkFlushTimer = null }
    set({ transcriptions: [], qaPairs: [], currentStreamingId: null, streamingIds: [], isPaused: false })
  },
  setModelHealth: (index, status) => set((s) => ({ modelHealth: { ...s.modelHealth, [index]: status } })),
  setTokenUsage: (usage) =>
    set({
      tokenUsage: {
        prompt: usage.prompt,
        completion: usage.completion,
        total: usage.total,
        byModel: usage.byModel ?? {},
      },
    }),
  setFallbackToast: (toast) => set({ fallbackToast: toast }),
  setToastMessage: (msg) => set({ toastMessage: msg }),
  setLastWSError: (msg) => set({ lastWSError: msg }),
  setWsConnected: (v) => set({ wsConnected: v }),

  appendResumeOptChunk: (chunk) => set((s) => ({ resumeOptStreaming: s.resumeOptStreaming + chunk })),
  setResumeOptResult: (text) => set({ resumeOptResult: text, resumeOptStreaming: '' }),
  setResumeOptLoading: (v) => set({ resumeOptLoading: v }),
  resetResumeOpt: () => set({ resumeOptStreaming: '', resumeOptResult: '', resumeOptLoading: false }),

  setPracticeStatus: (s) =>
    set(() => (
      s === 'idle' || s === 'generating'
        ? { practiceStatus: s, practiceAnswerDraft: '' }
        : { practiceStatus: s }
    )),
  setPracticeQuestions: (qs) => set({ practiceQuestions: qs, practiceIndex: 0, practiceAnswerDraft: '' }),
  setPracticeIndex: (i) => set({ practiceIndex: i, practiceAnswerDraft: '' }),
  appendPracticeEvalChunk: (chunk) => set((s) => ({ practiceEvalStreaming: s.practiceEvalStreaming + chunk })),
  finalizePracticeEval: (ev) =>
    set((s) => ({
      practiceEvals: [...s.practiceEvals, ev],
      practiceEvalStreaming: '',
    })),
  appendPracticeReportChunk: (chunk) => set((s) => ({ practiceReportStreaming: s.practiceReportStreaming + chunk })),
  finalizePracticeReport: (report) => set({ practiceReport: report, practiceReportStreaming: '' }),
  setPracticeRecording: (v) => set({ practiceRecording: v }),
  setPracticeAnswerDraft: (text) => set({ practiceAnswerDraft: text }),
  appendPracticeAnswerDraft: (text) =>
    set((s) => ({
      practiceAnswerDraft: s.practiceAnswerDraft ? `${s.practiceAnswerDraft} ${text}` : text,
    })),
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
      practiceAnswerDraft: '',
    }),
}))

