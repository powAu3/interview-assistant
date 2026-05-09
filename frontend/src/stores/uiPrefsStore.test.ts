import { beforeEach, describe, expect, it } from 'vitest'
import { __UI_PREFS_TEST_KEYS, useUiPrefsStore } from './uiPrefsStore'

describe('uiPrefsStore overlay state sync', () => {
  beforeEach(() => {
    localStorage.clear()
    useUiPrefsStore.setState({
      interviewOverlayEnabled: false,
      interviewOverlayOpacity: 0.88,
      interviewOverlayFontSize: 14,
      interviewOverlayFontColor: '#e2e8f0',
      interviewOverlayShowBg: true,
      interviewOverlayMaxLines: 0,
    })
  })

  it('does not overwrite local style preferences from uninitialized main-process defaults', () => {
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayOpacity, '0.42')
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayEnabled, '1')
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayFontSize, '22')
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayFontColor, '#abcdef')
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayShowBg, '0')
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayMaxLines, '7')
    useUiPrefsStore.getState().syncInterviewOverlayPrefs()

    useUiPrefsStore.getState().applyInterviewOverlayState({
      initialized: false,
      enabled: false,
      opacity: 0.88,
      fontSize: 14,
      fontColor: '#e2e8f0',
      showBg: true,
      maxLines: 0,
    })

    const state = useUiPrefsStore.getState()
    expect(state.interviewOverlayEnabled).toBe(true)
    expect(state.interviewOverlayOpacity).toBe(0.42)
    expect(state.interviewOverlayFontSize).toBe(22)
    expect(state.interviewOverlayFontColor).toBe('#abcdef')
    expect(state.interviewOverlayShowBg).toBe(false)
    expect(state.interviewOverlayMaxLines).toBe(7)
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayOpacity)).toBe('0.42')
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayEnabled)).toBe('1')
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayFontSize)).toBe('22')
  })

  it('persists initialized main-process style after explicit sync', () => {
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayOpacity, '0.42')
    useUiPrefsStore.getState().syncInterviewOverlayPrefs()

    useUiPrefsStore.getState().applyInterviewOverlayState({
      initialized: true,
      enabled: true,
      opacity: 0.7,
      fontSize: 18,
      fontColor: '#123456',
      showBg: true,
      maxLines: 4,
    })

    const state = useUiPrefsStore.getState()
    expect(state.interviewOverlayEnabled).toBe(true)
    expect(state.interviewOverlayOpacity).toBe(0.7)
    expect(state.interviewOverlayFontSize).toBe(18)
    expect(state.interviewOverlayFontColor).toBe('#123456')
    expect(state.interviewOverlayMaxLines).toBe(4)
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayOpacity)).toBe('0.7')
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayFontColor)).toBe('#123456')
  })
})
