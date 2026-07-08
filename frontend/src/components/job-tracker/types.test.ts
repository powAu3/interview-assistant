import { describe, expect, it } from 'vitest'

import { parseApplication, parseOffer, parseReviewScore } from './types'

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

  it('keeps invalid application numeric fields from leaking NaN into the UI', () => {
    const app = parseApplication({
      id: '42',
      company: 'Acme',
      position: 'Backend',
      applied_at: '',
      next_followup_at: 'not-a-timestamp',
      created_at: 'bad',
      updated_at: 'also bad',
      sort_order: 'nope',
      review_summary: {
        review_count: 'unknown',
        latest_review_id: '',
        latest_review_at: 'invalid',
        linked_review_count: '-2',
        latest_linked_review_id: 'NaN',
        latest_linked_review_at: '',
      },
    })

    expect(app.id).toBe(42)
    expect(app.applied_at).toBeNull()
    expect(app.next_followup_at).toBeNull()
    expect(app.created_at).toBe(0)
    expect(app.updated_at).toBe(0)
    expect(app.sort_order).toBe(0)
    expect(app.review_summary.review_count).toBe(0)
    expect(app.review_summary.linked_review_count).toBe(0)
    expect(app.review_summary.latest_review_id).toBeNull()
    expect(app.review_summary.latest_review_at).toBeNull()
    expect(app.review_summary.latest_linked_review_id).toBeNull()
    expect(app.review_summary.latest_linked_review_at).toBeNull()
  })

  it('normalizes offer numeric fields while parsing offers', () => {
    const offer = parseOffer({
      id: '7',
      application_id: '42',
      deadline: 'invalid',
      created_at: 'bad',
    })

    expect(offer.id).toBe(7)
    expect(offer.application_id).toBe(42)
    expect(offer.deadline).toBeNull()
    expect(offer.created_at).toBe(0)
  })
})
