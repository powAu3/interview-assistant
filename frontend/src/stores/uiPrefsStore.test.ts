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
      interviewOverlayMode: 'glass',
      interviewOverlayFocusWidthPct: 96,
      interviewOverlayFocusHeightPct: 90,
      interviewOverlayPromptMaxWidth: 900,
      interviewOverlayPromptAutoFollow: false,
      interviewOverlayMaxLines: 0,
      interviewOverlayVisible: false,
    })
  })

  it('does not overwrite local style preferences from uninitialized main-process defaults', () => {
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayOpacity, '0.42')
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayEnabled, '1')
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayFontSize, '22')
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayFontColor, '#abcdef')
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayShowBg, '0')
    localStorage.removeItem(__UI_PREFS_TEST_KEYS.overlayMode)
    localStorage.setItem(__UI_PREFS_TEST_KEYS.overlayPromptAutoFollow, '1')
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
    expect(state.interviewOverlayMode).toBe('prompt')
    expect(state.interviewOverlayPromptAutoFollow).toBe(true)
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
      mode: 'focus',
      focusWidthPct: 88,
      focusHeightPct: 76,
      promptAutoFollow: true,
      showBg: true,
      maxLines: 4,
    })

    const state = useUiPrefsStore.getState()
    expect(state.interviewOverlayEnabled).toBe(true)
    expect(state.interviewOverlayOpacity).toBe(0.7)
    expect(state.interviewOverlayFontSize).toBe(18)
    expect(state.interviewOverlayFontColor).toBe('#123456')
    expect(state.interviewOverlayMode).toBe('focus')
    expect(state.interviewOverlayShowBg).toBe(true)
    expect(state.interviewOverlayFocusWidthPct).toBe(88)
    expect(state.interviewOverlayFocusHeightPct).toBe(76)
    expect(state.interviewOverlayPromptAutoFollow).toBe(true)
    expect(state.interviewOverlayMaxLines).toBe(4)
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayOpacity)).toBe('0.7')
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayFontColor)).toBe('#123456')
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayMode)).toBe('focus')
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayShowBg)).toBe('1')
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayFocusWidthPct)).toBe('88')
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayFocusHeightPct)).toBe('76')
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayPromptAutoFollow)).toBe('1')
  })

  it('setInterviewOverlayMode persists focus mode and compatibility showBg', () => {
    useUiPrefsStore.getState().setInterviewOverlayMode('focus')

    expect(useUiPrefsStore.getState()).toMatchObject({
      interviewOverlayMode: 'focus',
      interviewOverlayShowBg: true,
    })
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayMode)).toBe('focus')
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayShowBg)).toBe('1')
  })

  it('persists custom focus panel dimensions', () => {
    useUiPrefsStore.getState().setInterviewOverlayFocusWidthPct(82)
    useUiPrefsStore.getState().setInterviewOverlayFocusHeightPct(64)

    expect(useUiPrefsStore.getState()).toMatchObject({
      interviewOverlayFocusWidthPct: 82,
      interviewOverlayFocusHeightPct: 64,
    })
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayFocusWidthPct)).toBe('82')
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayFocusHeightPct)).toBe('64')
  })

  it('defaults prompt auto-follow off and persists opt-in', () => {
    expect(useUiPrefsStore.getState().interviewOverlayPromptAutoFollow).toBe(false)

    useUiPrefsStore.getState().setInterviewOverlayPromptAutoFollow(true)

    expect(useUiPrefsStore.getState().interviewOverlayPromptAutoFollow).toBe(true)
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayPromptAutoFollow)).toBe('1')
  })

  it('tracks overlay window visibility without persisting it as a style preference', () => {
    useUiPrefsStore.getState().applyInterviewOverlayState({
      initialized: false,
      enabled: false,
      visible: true,
      opacity: 0.88,
      fontSize: 14,
      fontColor: '#e2e8f0',
      showBg: true,
      maxLines: 0,
    })

    expect(useUiPrefsStore.getState().interviewOverlayVisible).toBe(true)
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayEnabled)).toBeNull()
    expect(localStorage.getItem(__UI_PREFS_TEST_KEYS.overlayOpacity)).toBeNull()
  })
})
