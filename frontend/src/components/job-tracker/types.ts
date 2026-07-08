import { parseReviewScore } from '@/lib/reviewScore'

export { parseReviewScore } from '@/lib/reviewScore'

export type Stage =
  | 'applied'
  | 'written'
  | 'interview1'
  | 'interview2'
  | 'interview3'
  | 'hr'
  | 'offer'
  | 'written_rejected'
  | 'interview1_rejected'
  | 'interview2_rejected'
  | 'interview3_rejected'
  | 'hr_rejected'
  | 'rejected'
  | 'withdrawn'

export interface TodoItem {
  id: string
  title: string
  done?: boolean
  due?: string
}

export interface ApplicationReviewSummary {
  review_count: number
  latest_review_id: number | null
  latest_avg_score: number | null
  latest_review_at: number | null
  latest_status: string | null
  linked_review_count?: number
  latest_linked_review_id?: number | null
  latest_linked_avg_score?: number | null
  latest_linked_review_at?: number | null
  latest_linked_status?: string | null
}

export interface Application {
  id: number
  company: string
  position: string
  city: string
  stage: string
  applied_at: number | null
  next_followup_at: number | null
  interviewer_info: string
  feedback: string
  todos: TodoItem[]
  notes: string
  created_at: number
  updated_at: number
  sort_order: number
  review_summary: ApplicationReviewSummary
}

export interface Offer {
  id: number
  application_id: number
  base_salary: string
  total_pkg_note: string
  bonus: string
  equity: string
  benefits: string[]
  wfh: string
  location: string
  pros: string
  cons: string
  deadline: number | null
  created_at: number
  company?: string
  position?: string
}

function finiteNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseNumber(value: unknown, fallback = 0): number {
  return finiteNumber(value) ?? fallback
}

function parseNullableNumber(value: unknown): number | null {
  return finiteNumber(value)
}

function parseCount(value: unknown, fallback = 0): number {
  return Math.max(0, Math.floor(parseNumber(value, fallback)))
}

export function parseApplication(raw: Record<string, unknown>): Application {
  const todos = raw.todos
  const reviewSummary = (raw.review_summary && typeof raw.review_summary === 'object'
    ? raw.review_summary
    : {}) as Partial<ApplicationReviewSummary>
  const reviewCount = parseCount(reviewSummary.review_count)
  const linkedReviewCount = parseCount(reviewSummary.linked_review_count, reviewCount)
  return {
    id: parseNumber(raw.id),
    company: String(raw.company ?? ''),
    position: String(raw.position ?? ''),
    city: String(raw.city ?? ''),
    stage: String(raw.stage ?? 'applied'),
    applied_at: parseNullableNumber(raw.applied_at),
    next_followup_at: parseNullableNumber(raw.next_followup_at),
    interviewer_info: String(raw.interviewer_info ?? ''),
    feedback: String(raw.feedback ?? ''),
    notes: String(raw.notes ?? ''),
    created_at: parseNumber(raw.created_at),
    updated_at: parseNumber(raw.updated_at),
    sort_order: parseNumber(raw.sort_order),
    todos: Array.isArray(todos) ? (todos as TodoItem[]) : [],
    review_summary: {
      review_count: reviewCount,
      latest_review_id: parseNullableNumber(reviewSummary.latest_review_id),
      latest_avg_score: parseReviewScore(reviewSummary.latest_avg_score),
      latest_review_at: parseNullableNumber(reviewSummary.latest_review_at),
      latest_status: reviewSummary.latest_status != null ? String(reviewSummary.latest_status) : null,
      linked_review_count: linkedReviewCount,
      latest_linked_review_id: parseNullableNumber(reviewSummary.latest_linked_review_id),
      latest_linked_avg_score: parseReviewScore(reviewSummary.latest_linked_avg_score),
      latest_linked_review_at: parseNullableNumber(reviewSummary.latest_linked_review_at),
      latest_linked_status: reviewSummary.latest_linked_status != null ? String(reviewSummary.latest_linked_status) : null,
    },
  }
}

export function parseOffer(raw: Record<string, unknown>): Offer {
  const benefits = raw.benefits
  return {
    id: parseNumber(raw.id),
    application_id: parseNumber(raw.application_id),
    base_salary: String(raw.base_salary ?? ''),
    total_pkg_note: String(raw.total_pkg_note ?? ''),
    bonus: String(raw.bonus ?? ''),
    equity: String(raw.equity ?? ''),
    benefits: Array.isArray(benefits) ? (benefits as string[]) : [],
    wfh: String(raw.wfh ?? ''),
    location: String(raw.location ?? ''),
    pros: String(raw.pros ?? ''),
    cons: String(raw.cons ?? ''),
    deadline: parseNullableNumber(raw.deadline),
    created_at: parseNumber(raw.created_at),
    company: raw.company != null ? String(raw.company) : undefined,
    position: raw.position != null ? String(raw.position) : undefined,
  }
}
