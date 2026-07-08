import { describe, expect, it } from 'vitest'

import { parseApplication, parseReviewScore } from './types'

describe('job tracker types', () => {
  it('parses review score numbers from backend labels', () => {
    expect(parseReviewScore(8)).toBe(8)
    expect(parseReviewScore('8.2分')).toBe(8.2)
    expect(parseReviewScore('无法评分')).toBeNull()
    expect(parseReviewScore('11')).toBeNull()
  })

  it('normalizes review summary score strings while parsing applications', () => {
    const app = parseApplication({
      id: 1,
      company: 'Acme',
      position: 'Backend',
      review_summary: {
        review_count: 1,
        latest_review_id: 10,
        latest_avg_score: '7.5分',
        latest_review_at: 1710000000,
        latest_status: 'completed',
        linked_review_count: 2,
        latest_linked_review_id: 11,
        latest_linked_avg_score: '无法评分',
        latest_linked_review_at: 1710003600,
        latest_linked_status: 'recorded',
      },
    })

    expect(app.review_summary.latest_avg_score).toBe(7.5)
    expect(app.review_summary.latest_linked_avg_score).toBeNull()
  })
})
