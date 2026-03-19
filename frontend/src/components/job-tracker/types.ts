export type Stage =
  | 'applied'
  | 'written'
  | 'interview1'
  | 'interview2'
  | 'interview3'
  | 'hr'
  | 'offer'
  | 'rejected'
  | 'withdrawn'

export interface TodoItem {
  id: string
  title: string
  done?: boolean
  due?: string
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

export function parseApplication(raw: Record<string, unknown>): Application {
  const todos = raw.todos
  return {
    id: Number(raw.id),
    company: String(raw.company ?? ''),
    position: String(raw.position ?? ''),
    city: String(raw.city ?? ''),
    stage: String(raw.stage ?? 'applied'),
    applied_at: raw.applied_at != null ? Number(raw.applied_at) : null,
    next_followup_at: raw.next_followup_at != null ? Number(raw.next_followup_at) : null,
    interviewer_info: String(raw.interviewer_info ?? ''),
    feedback: String(raw.feedback ?? ''),
    notes: String(raw.notes ?? ''),
    created_at: Number(raw.created_at ?? 0),
    updated_at: Number(raw.updated_at ?? 0),
    sort_order: Number(raw.sort_order ?? 0),
    todos: Array.isArray(todos) ? (todos as TodoItem[]) : [],
  }
}

export function parseOffer(raw: Record<string, unknown>): Offer {
  const benefits = raw.benefits
  return {
    id: Number(raw.id),
    application_id: Number(raw.application_id),
    base_salary: String(raw.base_salary ?? ''),
    total_pkg_note: String(raw.total_pkg_note ?? ''),
    bonus: String(raw.bonus ?? ''),
    equity: String(raw.equity ?? ''),
    benefits: Array.isArray(benefits) ? (benefits as string[]) : [],
    wfh: String(raw.wfh ?? ''),
    location: String(raw.location ?? ''),
    pros: String(raw.pros ?? ''),
    cons: String(raw.cons ?? ''),
    deadline: raw.deadline != null ? Number(raw.deadline) : null,
    created_at: Number(raw.created_at ?? 0),
    company: raw.company != null ? String(raw.company) : undefined,
    position: raw.position != null ? String(raw.position) : undefined,
  }
}
