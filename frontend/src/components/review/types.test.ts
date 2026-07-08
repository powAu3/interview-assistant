import { describe, expect, it } from 'vitest'

import { parseReviewSession, parseReviewSessionDetail, parseReviewSessionsResponse } from './types'

describe('review types', () => {
  it('normalizes review session score strings', () => {
    const session = parseReviewSession({
      id: '7',
      status: 'completed',
      started_at: '1710000000',
      ended_at: '1710003600',
      source: 'assist',
      turn_count: '5',
      avg_score: '8.4分',
      auto_sync_eligible: 'false',
      interviewer_capture_enabled: 'true',
      candidate_capture_enabled: 'false',
      summary_markdown: '整体稳定。',
      created_at: 1710000000,
      updated_at: 1710003600,
    })

    expect(session.id).toBe(7)
    expect(session.avg_score).toBe(8.4)
    expect(session.turn_count).toBe(5)
    expect(session.auto_sync_eligible).toBe(false)
    expect(session.interviewer_capture_enabled).toBe(true)
    expect(session.candidate_capture_enabled).toBe(false)
  })

  it('drops invalid score strings from review responses', () => {
    const resp = parseReviewSessionsResponse({
      total: '1',
      page: '1',
      page_size: '20',
      items: [{
        id: 8,
        status: 'completed',
        started_at: 1710000000,
        source: 'assist',
        turn_count: 3,
        avg_score: '无法评分',
        created_at: 1710000000,
        updated_at: 1710003600,
      }],
    })

    expect(resp.items[0].avg_score).toBeNull()
  })

  it('normalizes review detail score strings without touching scorecards', () => {
    const detail = parseReviewSessionDetail({
      id: 9,
      status: 'completed',
      started_at: 1710000000,
      source: 'assist',
      turn_count: 1,
      avg_score: '7.5分',
      created_at: 1710000000,
      updated_at: 1710003600,
      turns: [{
        id: 91,
        session_id: 9,
        qa_id: 'qa-1',
        seq: 1,
        question_text: 'Redis 缓存击穿怎么处理？',
        candidate_answer_text: '互斥锁。',
        is_partial: 'false',
        analysis_status: 'completed',
        scorecard: { 准确性: '8.0分' },
      }],
    })

    expect(detail.avg_score).toBe(7.5)
    expect(detail.turns[0].is_partial).toBe(false)
    expect(detail.turns[0].scorecard).toEqual({ 准确性: '8.0分' })
  })

  it('treats blank nullable numbers as missing and clamps counters', () => {
    const detail = parseReviewSessionDetail({
      id: '10',
      status: 'completed',
      started_at: '1710000000',
      ended_at: '',
      source: 'assist',
      application_id: '',
      application: {
        id: '3',
        company: 'Acme',
        updated_at: '',
      },
      turn_count: '-4',
      avg_score: '无法评分',
      created_at: 1710000000,
      updated_at: 1710003600,
      turns: [{
        id: 101,
        session_id: 10,
        seq: 1,
        duration_ms: '-1200',
      }],
    })

    expect(detail.ended_at).toBeNull()
    expect(detail.application_id).toBeNull()
    expect(detail.application?.updated_at).toBeNull()
    expect(detail.turn_count).toBe(0)
    expect(detail.turns[0].duration_ms).toBe(0)

    const resp = parseReviewSessionsResponse({
      total: '-5',
      page: '-2',
      page_size: '0',
      items: [],
    })
    expect(resp.total).toBe(0)
    expect(resp.page).toBe(1)
    expect(resp.page_size).toBe(1)
  })
})
