import { describe, expect, it } from 'vitest'

import { parseApplication } from './types'

describe('job tracker types', () => {
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
