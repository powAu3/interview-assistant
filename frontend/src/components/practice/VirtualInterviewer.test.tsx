import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VirtualInterviewer } from './VirtualInterviewer'

describe('VirtualInterviewer', () => {
  it('updates persona metadata when the persona changes', () => {
    const { rerender } = render(
      <VirtualInterviewer
        persona="calm_pressing"
        state="idle"
        signal="warm-open"
        data-testid="virtual-interviewer"
      />,
    )

    const avatar = screen.getByTestId('virtual-interviewer')
    expect(avatar).toHaveAttribute('data-persona', 'calm_pressing')
    expect(avatar).toHaveAttribute('aria-label', expect.stringContaining('稳压型面试官'))

    rerender(
      <VirtualInterviewer
        persona="supportive_senior"
        state="idle"
        signal="warm-open"
        data-testid="virtual-interviewer"
      />,
    )

    expect(avatar).toHaveAttribute('data-persona', 'supportive_senior')
    expect(avatar).toHaveAttribute('aria-label', expect.stringContaining('带教型面试官'))
  })

  it('uses the written prompt state label for assistive text', () => {
    render(
      <VirtualInterviewer
        persona="calm_pressing"
        state="idle"
        signal="implementation-check"
        writtenPromptMode
        data-testid="virtual-interviewer"
      />,
    )

    expect(screen.getByTestId('virtual-interviewer')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('静读题面'),
    )
  })

  it('uses the synthetic human portrait renderer instead of WebGL', () => {
    render(
      <VirtualInterviewer
        persona="calm_pressing"
        state="speaking"
        speechSignal={{
          active: true,
          energy: 0.68,
          mouthOpen: 0.52,
          speakingElapsedMs: 420,
        }}
        data-testid="virtual-interviewer"
      />,
    )

    const avatar = screen.getByTestId('virtual-interviewer')
    expect(avatar).toHaveAttribute('data-renderer', 'human-portrait')
    expect(avatar).toHaveAttribute('data-speech-active', 'true')
    expect(screen.getByTestId('virtual-interviewer-human-portrait')).toBeInTheDocument()
    expect(screen.queryByTestId('virtual-interviewer-three-stage')).not.toBeInTheDocument()
    expect(screen.queryByTestId('virtual-interviewer-live2d-stage')).not.toBeInTheDocument()
  })

  it('keeps speech energy scoped to the speaking state', () => {
    render(
      <VirtualInterviewer
        persona="pressure_bigtech"
        state="listening"
        speechSignal={{
          active: true,
          energy: 0.8,
          mouthOpen: 0.7,
          speakingElapsedMs: 1200,
        }}
        compact
        data-testid="virtual-interviewer"
      />,
    )

    expect(screen.getByTestId('virtual-interviewer')).toHaveAttribute(
      'data-renderer',
      'human-portrait',
    )
    expect(screen.getByTestId('virtual-interviewer')).toHaveAttribute('data-speech-active', 'false')
    expect(screen.getByTestId('virtual-interviewer-human-portrait')).toBeInTheDocument()
    expect(screen.queryByTestId('virtual-interviewer-rig-preview')).not.toBeInTheDocument()
  })
})
