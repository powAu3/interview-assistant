import { describe, expect, it } from 'vitest'

import { filterApplicationsBySearch, matchesApplicationSearch } from './search'
import type { Application } from './types'

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: 1,
    company: 'Acme',
    position: 'Frontend Engineer',
    city: 'Shanghai',
    stage: 'interview2',
    applied_at: null,
    next_followup_at: null,
    interviewer_info: '',
    feedback: '',
    todos: [],
    notes: '',
    created_at: 1710000000,
    updated_at: 1710000000,
    sort_order: 0,
    review_summary: {
      review_count: 0,
      latest_review_id: null,
      latest_avg_score: null,
      latest_review_at: null,
      latest_status: null,
    },
    ...overrides,
  }
}

describe('job tracker search', () => {
  it('matches follow-up todo, interviewer info, feedback, and review score signals', () => {
    const item = application({
      interviewer_info: '三面面试官偏系统设计',
      feedback: '反馈说容量估算还要补强',
      todos: [
        { id: 'todo-1', title: '周五前跟进 recruiter', done: false, due: '2026-07-10' },
      ],
      review_summary: {
        review_count: 1,
        latest_review_id: 11,
        latest_avg_score: 7.6,
        latest_review_at: 1710003600,
        latest_status: 'completed',
      },
    })

    expect(matchesApplicationSearch(item, 'recruiter')).toBe(true)
    expect(matchesApplicationSearch(item, '系统设计')).toBe(true)
    expect(matchesApplicationSearch(item, '容量估算')).toBe(true)
    expect(matchesApplicationSearch(item, '7.6')).toBe(true)
    expect(matchesApplicationSearch(item, '2026-07-10')).toBe(true)
  })

  it('keeps filtering consistent for table and kanban consumers', () => {
    const applications = [
      application({ id: 1, company: 'Acme', todos: [{ id: 't1', title: '补充复盘待办' }] }),
      application({ id: 2, company: 'MiniMax', notes: 'HR 已约下周' }),
    ]

    expect(filterApplicationsBySearch(applications, '复盘待办').map((item) => item.company)).toEqual(['Acme'])
    expect(filterApplicationsBySearch(applications, '下周').map((item) => item.company)).toEqual(['MiniMax'])
  })
})
