import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PreferencesTab from './PreferencesTab'
import { updateConfigAndRefresh } from '@/lib/configSync'
import { useInterviewStore } from '@/stores/configStore'

vi.mock('@/lib/configSync', () => ({
  updateConfigAndRefresh: vi.fn().mockResolvedValue({ ok: true }),
}))

describe('PreferencesTab', () => {
  beforeEach(() => {
    vi.mocked(updateConfigAndRefresh).mockClear()
    useInterviewStore.setState({
      config: {
        stt_provider: 'whisper',
        screen_capture_region: 'left_half',
        screen_capture_max_long_edge: 1600,
        multi_screen_capture_idle_sec: 10,
        written_exam_mode: false,
        written_exam_think: false,
      },
      options: {
        screen_capture_regions: ['full', 'left_half', 'right_half'],
      },
      platformInfo: null,
      sttLoaded: true,
      sttLoading: false,
      sttActiveProvider: 'whisper',
      sttFallbackLoaded: false,
    } as any)
  })

  it('exposes the screen capture long-edge limit', async () => {
    render(<PreferencesTab />)

    fireEvent.click(screen.getByText('工作模式'))
    expect(screen.getByText('截图最长边: 1600px')).toBeInTheDocument()
    const input = screen.getByDisplayValue('1600')

    fireEvent.change(input, { target: { value: '2400' } })

    await waitFor(() => {
      expect(updateConfigAndRefresh).toHaveBeenCalledWith({ screen_capture_max_long_edge: 2400 })
    })
  })

  it('allows zero to disable screen capture scaling', async () => {
    render(<PreferencesTab />)

    fireEvent.click(screen.getByText('工作模式'))
    fireEvent.change(screen.getByDisplayValue('1600'), { target: { value: '0' } })

    await waitFor(() => {
      expect(updateConfigAndRefresh).toHaveBeenCalledWith({ screen_capture_max_long_edge: 0 })
    })
  })
})
