import { useEffect, useState } from 'react'
import ReviewSessionList from './review/ReviewSessionList'
import ReviewSessionDetail from './review/ReviewSessionDetail'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

type ViewMode = 'list' | 'detail'

export default function ReviewMode() {
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)
  const reviewDeepLinkSessionId = useUiPrefsStore((s) => s.reviewDeepLinkSessionId)
  const clearReviewDeepLinkSessionId = useUiPrefsStore((s) => s.clearReviewDeepLinkSessionId)

  useEffect(() => {
    if (reviewDeepLinkSessionId == null) return
    setSelectedSessionId(reviewDeepLinkSessionId)
    setViewMode('detail')
    clearReviewDeepLinkSessionId()
  }, [clearReviewDeepLinkSessionId, reviewDeepLinkSessionId])

  const handleViewDetail = (sessionId: number) => {
    setSelectedSessionId(sessionId)
    setViewMode('detail')
  }

  const handleBackToList = () => {
    setViewMode('list')
    setSelectedSessionId(null)
  }

  if (viewMode === 'detail' && selectedSessionId !== null) {
    return <ReviewSessionDetail sessionId={selectedSessionId} onBack={handleBackToList} />
  }

  return <ReviewSessionList onViewDetail={handleViewDetail} />
}
