import type { StateCreator } from 'zustand'
import type { RootState } from './rootState'
import type { QAPair } from './types'

const CHUNK_THROTTLE_MS = 50

const _chunkBuffer: Map<string, { answer: string; think: string }> = new Map()
let _chunkFlushTimer: ReturnType<typeof setTimeout> | null = null

function _scheduleChunkFlush(set: (fn: (s: RootState) => Partial<RootState>) => void) {
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

export interface InterviewSliceState {
  isRecording: boolean
  isPaused: boolean
  audioLevel: number
  isTranscribing: boolean
  transcriptions: string[]
  qaPairs: QAPair[]
  streamingIds: string[]
  currentStreamingId: string | null
}

export interface InterviewSliceActions {
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
  setVisionVerify: (id: string, verdict: 'PASS' | 'FAIL' | 'UNKNOWN', reason: string) => void
  setInitData: (data: any) => void
  clearSession: () => void
}

export type InterviewSlice = InterviewSliceState & InterviewSliceActions

export const createInterviewSlice: StateCreator<RootState, [], [], InterviewSlice> = (set) => ({
  isRecording: false,
  isPaused: false,
  audioLevel: 0,
  isTranscribing: false,
  transcriptions: [],
  qaPairs: [],
  streamingIds: [],
  currentStreamingId: null,

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

  setVisionVerify: (id, verdict, reason) =>
    set((s) => ({
      qaPairs: s.qaPairs.map((qa) =>
        qa.id === id ? { ...qa, visionVerify: { verdict, reason } } : qa,
      ),
    })),

  setInitData: (data) => {
    _chunkBuffer.clear()
    if (_chunkFlushTimer !== null) {
      clearTimeout(_chunkFlushTimer)
      _chunkFlushTimer = null
    }
    set({
      transcriptions: data.transcriptions ?? [],
      qaPairs: (data.qa_pairs ?? []).map(
        (qa: Partial<QAPair> & { id: string; question: string; answer: string }) => ({
          ...qa,
          thinkContent: qa.thinkContent ?? '',
          isThinking: false,
          timestamp: qa.timestamp ?? Date.now() / 1000,
          questionSource: (qa as any).source ?? qa.questionSource,
          modelLabel: (qa as any).model_name ?? qa.modelLabel,
        }),
      ),
      currentStreamingId: null,
      streamingIds: [],
      isRecording: data.is_recording ?? false,
      isPaused: data.is_paused ?? false,
      sttLoaded: data.stt_loaded ?? false,
    })
  },

  clearSession: () => {
    _chunkBuffer.clear()
    if (_chunkFlushTimer !== null) {
      clearTimeout(_chunkFlushTimer)
      _chunkFlushTimer = null
    }
    set({
      transcriptions: [],
      qaPairs: [],
      currentStreamingId: null,
      streamingIds: [],
      isPaused: false,
    })
  },
})
