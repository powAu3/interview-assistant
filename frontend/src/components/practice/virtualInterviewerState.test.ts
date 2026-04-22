import { describe, expect, it } from 'vitest'

import { resolveVirtualInterviewerState } from './virtualInterviewerState'

describe('resolveVirtualInterviewerState', () => {
  it('maps the five booth states from practice signals', () => {
    expect(
      resolveVirtualInterviewerState({
        practiceStatus: 'interviewer_speaking',
        practiceTtsSpeaking: false,
        practiceRecording: false,
        turn: { category: 'project', answer_mode: 'voice' },
      }),
    ).toBe('speaking')

    expect(
      resolveVirtualInterviewerState({
        practiceStatus: 'awaiting_answer',
        practiceTtsSpeaking: false,
        practiceRecording: false,
        turn: { category: 'project', answer_mode: 'voice' },
      }),
    ).toBe('listening')

    expect(
      resolveVirtualInterviewerState({
        practiceStatus: 'thinking_next_turn',
        practiceTtsSpeaking: false,
        practiceRecording: false,
        turn: { category: 'design', answer_mode: 'voice' },
      }),
    ).toBe('thinking')

    expect(
      resolveVirtualInterviewerState({
        practiceStatus: 'debriefing',
        practiceTtsSpeaking: false,
        practiceRecording: false,
        turn: null,
      }),
    ).toBe('debrief')

    expect(
      resolveVirtualInterviewerState({
        practiceStatus: 'finished',
        practiceTtsSpeaking: false,
        practiceRecording: false,
        turn: null,
      }),
    ).toBe('debrief')

    expect(
      resolveVirtualInterviewerState({
        practiceStatus: 'preparing',
        practiceTtsSpeaking: false,
        practiceRecording: false,
        turn: null,
      }),
    ).toBe('idle')
  })

  it('does not enter speaking during coding prompt mode', () => {
    expect(
      resolveVirtualInterviewerState({
        practiceStatus: 'interviewer_speaking',
        practiceTtsSpeaking: true,
        practiceRecording: false,
        turn: { category: 'coding', answer_mode: 'voice+code' },
      }),
    ).toBe('idle')

    expect(
      resolveVirtualInterviewerState({
        practiceStatus: 'awaiting_answer',
        practiceTtsSpeaking: true,
        practiceRecording: true,
        turn: { category: 'coding', answer_mode: 'voice+code' },
      }),
    ).toBe('listening')
  })
})
