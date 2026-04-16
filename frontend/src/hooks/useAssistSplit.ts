import { useEffect, useRef } from 'react'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

export function useAssistSplit() {
  const assistSplitPct = useUiPrefsStore((s) => s.assistSplitPct)
  const setAssistSplitPct = useUiPrefsStore((s) => s.setAssistSplitPct)
  const persistAssistSplitPct = useUiPrefsStore((s) => s.persistAssistSplitPct)
  const assistSplitContainerRef = useRef<HTMLDivElement>(null)
  const assistSplitDragging = useRef(false)
  const assistSplitPctRef = useRef(assistSplitPct)

  useEffect(() => {
    assistSplitPctRef.current = assistSplitPct
  }, [assistSplitPct])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!assistSplitDragging.current || !assistSplitContainerRef.current) return
      const r = assistSplitContainerRef.current.getBoundingClientRect()
      if (r.width < 80) return
      const p = ((e.clientX - r.left) / r.width) * 100
      const c = Math.min(62, Math.max(24, p))
      assistSplitPctRef.current = c
      setAssistSplitPct(c)
    }
    const onUp = () => {
      if (!assistSplitDragging.current) return
      assistSplitDragging.current = false
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
      persistAssistSplitPct(assistSplitPctRef.current)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [persistAssistSplitPct, setAssistSplitPct])

  return {
    assistSplitContainerRef,
    assistSplitDragging,
    assistSplitPct,
    assistSplitPctRef,
    persistAssistSplitPct,
    setAssistSplitPct,
  }
}
