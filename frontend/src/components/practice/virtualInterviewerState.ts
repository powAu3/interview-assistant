import type { PracticeAnswerMode, PracticeStatus } from '@/stores/configStore'

export type VirtualInterviewerState =
  | 'speaking'
  | 'listening'
  | 'thinking'
  | 'idle'
  | 'debrief'

export interface VirtualInterviewerTurnSignal {
  category?: string | null
  answer_mode?: PracticeAnswerMode | null
}

export function isPracticeWrittenPromptMode(turn?: VirtualInterviewerTurnSignal | null) {
  if (!turn) return false
  return turn.category === 'coding' || turn.answer_mode === 'code' || turn.answer_mode === 'voice+code'
}

export function resolveVirtualInterviewerState(input: {
  practiceStatus?: PracticeStatus | null
  practiceTtsSpeaking?: boolean
  practiceRecording?: boolean
  turn?: VirtualInterviewerTurnSignal | null
}): VirtualInterviewerState {
  const writtenPromptMode = isPracticeWrittenPromptMode(input.turn)

  if (input.practiceStatus === 'debriefing') return 'debrief'
  if (input.practiceStatus === 'finished') return 'debrief'
  if (input.practiceStatus === 'thinking_next_turn') return 'thinking'
  if (!writtenPromptMode && input.practiceTtsSpeaking) {
    return 'speaking'
  }
  if (input.practiceRecording || input.practiceStatus === 'awaiting_answer') return 'listening'
  return 'idle'
}

export function getVirtualInterviewerStateLabel(
  state: VirtualInterviewerState,
  options?: { writtenPromptMode?: boolean },
) {
  if (options?.writtenPromptMode && state === 'idle') return '静读题面'
  switch (state) {
    case 'speaking':
      return '播报中'
    case 'listening':
      return '倾听中'
    case 'thinking':
      return '思考中'
    case 'debrief':
      return '复盘中'
    default:
      return '待机中'
  }
}
