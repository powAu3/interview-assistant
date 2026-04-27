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

  it('reserves a mature Live2D stage instead of a flat portrait asset', () => {
    render(
      <VirtualInterviewer
        persona="calm_pressing"
        state="idle"
        data-testid="virtual-interviewer"
      />,
    )

    expect(screen.getByTestId('virtual-interviewer')).toHaveAttribute(
      'data-renderer',
      'live2d',
    )
    expect(screen.getByTestId('virtual-interviewer-live2d-stage')).toBeInTheDocument()
    expect(screen.queryByTestId('virtual-interviewer-portrait')).not.toBeInTheDocument()
  })
})
