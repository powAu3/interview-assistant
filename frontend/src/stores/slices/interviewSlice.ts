import type { StateCreator } from 'zustand'
import type { RootState } from './rootState'
import type { QAPair, QAStatus } from './types'

const CHUNK_THROTTLE_MS = 50

const _chunkBuffer: Map<string, { answer: string; think: string }> = new Map()
let _chunkFlushTimer: ReturnType<typeof setTimeout> | null = null
let _candidateSegmentIds: Array<string | null> = []

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
  candidateTranscriptions: string[]
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
  addCandidateTranscription: (text: string, meta?: { segmentId?: string; isFinal?: boolean }) => void
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
    firstTokenMs?: number,
    totalMs?: number,
  ) => void
  cancelAnswer: (id: string) => void
  errorAnswer: (id: string, message: string) => void
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
  candidateTranscriptions: [],
  qaPairs: [],
  streamingIds: [],
  currentStreamingId: null,

  setRecording: (v) => set({ isRecording: v }),
  setPaused: (v) => set({ isPaused: v }),
  setAudioLevel: (v) => set({ audioLevel: v }),
  setTranscribing: (v) => set({ isTranscribing: v }),
  addTranscription: (text) => set((s) => ({ transcriptions: [...s.transcriptions, text] })),
  addCandidateTranscription: (text, meta) => set((s) => {
    const segmentId = meta?.segmentId || null
    if (segmentId) {
      const existingIndex = _candidateSegmentIds.lastIndexOf(segmentId)
      if (existingIndex >= 0 && existingIndex < s.candidateTranscriptions.length) {
        const next = [...s.candidateTranscriptions]
        next[existingIndex] = text
        return { candidateTranscriptions: next }
      }
    }
    if (s.candidateTranscriptions[s.candidateTranscriptions.length - 1] === text) {
      return { candidateTranscriptions: s.candidateTranscriptions }
    }
    _candidateSegmentIds = [..._candidateSegmentIds, segmentId]
    return { candidateTranscriptions: [...s.candidateTranscriptions, text] }
  }),

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
          status: 'streaming' as QAStatus,
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

  finalizeAnswer: (id, question, answer, thinkContent, modelName, firstTokenMs, totalMs) => {
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
                firstTokenMs: firstTokenMs ?? qa.firstTokenMs,
                totalMs: totalMs ?? qa.totalMs,
                status: 'done' as QAStatus,
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
          qa.id === id ? { ...qa, isThinking: false, status: 'cancelled' as QAStatus } : qa,
        ),
      }
    })
  },

  errorAnswer: (id, message) => {
    _chunkBuffer.delete(id)
    set((s) => {
      const next = s.streamingIds.filter((x) => x !== id)
      return {
        currentStreamingId: next.length ? next[next.length - 1] : null,
        streamingIds: next,
        qaPairs: s.qaPairs.map((qa) =>
          qa.id === id
            ? { ...qa, isThinking: false, status: 'error' as QAStatus, errorMessage: message }
            : qa,
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
    const candidateSegments = Array.isArray(data.candidate_answer_segments)
      ? data.candidate_answer_segments
      : []
    const restoredCandidateTranscriptions = candidateSegments.length > 0
      ? candidateSegments
          .map((segment: any) => String(segment?.text ?? '').trim())
          .filter(Boolean)
      : data.candidate_transcriptions ?? []
    _candidateSegmentIds = candidateSegments.length > 0
      ? candidateSegments
          .map((segment: any) => (segment?.segment_id ? String(segment.segment_id) : null))
          .filter((_segmentId: string | null, index: number) => Boolean(restoredCandidateTranscriptions[index]))
      : restoredCandidateTranscriptions.map(() => null)
    if (_chunkFlushTimer !== null) {
      clearTimeout(_chunkFlushTimer)
      _chunkFlushTimer = null
    }
    set({
      transcriptions: data.transcriptions ?? [],
      candidateTranscriptions: restoredCandidateTranscriptions,
      qaPairs: (data.qa_pairs ?? []).map(
        (qa: Partial<QAPair> & { id: string; question: string; answer: string }) => ({
          ...qa,
          thinkContent: qa.thinkContent ?? '',
          isThinking: false,
          timestamp: qa.timestamp ?? Date.now() / 1000,
          questionSource: (qa as any).source ?? qa.questionSource,
          modelLabel: (qa as any).model_name ?? qa.modelLabel,
          status: qa.status ?? 'done' as QAStatus,
        }),
      ),
      currentStreamingId: null,
      streamingIds: [],
      isRecording: data.is_recording ?? false,
      isPaused: data.is_paused ?? false,
      sttLoaded: data.stt_loaded ?? false,
      candidateSttLoaded: false,
      candidateSttLoading: false,
      candidateSttProvider: '',
    })
  },

  clearSession: () => {
    _chunkBuffer.clear()
    _candidateSegmentIds = []
    if (_chunkFlushTimer !== null) {
      clearTimeout(_chunkFlushTimer)
      _chunkFlushTimer = null
    }
    set({
      transcriptions: [],
      candidateTranscriptions: [],
      qaPairs: [],
      currentStreamingId: null,
      streamingIds: [],
      isPaused: false,
      candidateSttLoaded: false,
      candidateSttLoading: false,
      candidateSttProvider: '',
    })
  },
})
